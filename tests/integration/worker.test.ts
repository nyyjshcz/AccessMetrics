import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/crawler", () => ({
  discoverSite: vi.fn(),
}));
vi.mock("@/lib/scan-page", () => ({
  scanPage: vi.fn(),
  closeScanner: vi.fn(),
}));

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-worker-"));
const originalAppEnv = process.env.APP_ENV;
const originalAllowPrivateAddresses = process.env.SCAN_TEST_ALLOW_PRIVATE_ADDRESSES;
process.env.APP_ENV = "test";
process.env.SCAN_TEST_ALLOW_PRIVATE_ADDRESSES = "1";
process.env.DATABASE_URL = path.join(testRoot, "worker.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const crawler = await import("@/lib/crawler");
const worker = await import("@/worker/index");

describe("scan worker failure handling", () => {
  beforeAll(() => dbModule.migrate());
  afterAll(() => {
    dbModule.closeDb();
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
    if (originalAllowPrivateAddresses === undefined)
      delete process.env.SCAN_TEST_ALLOW_PRIVATE_ADDRESSES;
    else process.env.SCAN_TEST_ALLOW_PRIVATE_ADDRESSES = originalAllowPrivateAddresses;
  });

  it("finalizes a running run when discovery throws, preserving page counts", async () => {
    const site = repositories.upsertSite("http://127.0.0.1");
    const job = repositories.createScanJob(
      site.origin,
      { maxPages: 2, sameOriginOnly: true, respectRobots: true },
      "test",
      "worker-failure-job",
    );
    const workerId = `worker-${process.pid}`;
    expect(repositories.leaseNextJob(workerId)?.id).toBe(job.id);
    const run = repositories.createRun(repositories.getJob(job.id));
    const db = dbModule.getDb();
    db.prepare(
      "INSERT INTO pages(id,site_id,canonical_url,first_seen_at,run_id,scan_status) VALUES (?,?,?,?,?,?)",
    ).run(
      "worker-success-page",
      site.id,
      "http://127.0.0.1/success",
      new Date().toISOString(),
      run.id,
      "success",
    );
    db.prepare(
      "INSERT INTO pages(id,site_id,canonical_url,first_seen_at,run_id,scan_status) VALUES (?,?,?,?,?,?)",
    ).run(
      "worker-failed-page",
      site.id,
      "http://127.0.0.1/failed",
      new Date().toISOString(),
      run.id,
      "failed",
    );
    vi.mocked(crawler.discoverSite).mockRejectedValueOnce(new Error("discovery failed"));

    await expect(worker.processJob(repositories.getJob(job.id))).rejects.toThrow(
      "discovery failed",
    );

    const storedRun = db
      .prepare(
        "SELECT status,finished_at,page_count,success_count,failed_count FROM scan_runs WHERE id=?",
      )
      .get(run.id) as Record<string, unknown>;
    expect(storedRun).toMatchObject({
      status: "failed",
      page_count: 2,
      success_count: 1,
      failed_count: 1,
    });
    expect(storedRun.finished_at).toEqual(expect.any(String));
  });
});
