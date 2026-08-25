import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-recovery-"));
process.env.DATABASE_URL = path.join(testRoot, "recovery.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");

describe("worker lease recovery", () => {
  beforeAll(() => dbModule.migrate());
  afterAll(() => dbModule.closeDb());

  it("recovers stale jobs and only expired page leases", () => {
    const site = repositories.upsertSite("https://recovery.example");
    const job = repositories.createScanJob(
      site.origin,
      { maxPages: 2, sameOriginOnly: true, respectRobots: true },
      "test",
      "recovery-stale-job",
    );
    repositories.addDiscoveredPages(job.id, site.id, [
      "https://recovery.example/expired",
      "https://recovery.example/live",
    ]);
    const db = dbModule.getDb();
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const liveUntil = new Date(Date.now() + 60 * 1000).toISOString();
    const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
    db.prepare(
      "UPDATE scan_jobs SET status='running',worker_id='dead-worker',heartbeat_at=? WHERE id=?",
    ).run(staleAt, job.id);
    const pages = db
      .prepare("SELECT page_id FROM job_pages WHERE job_id=? ORDER BY discovery_order")
      .all(job.id) as Array<{ page_id: string }>;
    db.prepare(
      "UPDATE job_pages SET status='scanning',lease_owner='dead-worker',lease_expires_at=? WHERE job_id=? AND page_id=?",
    ).run(expiredAt, job.id, pages[0].page_id);
    db.prepare(
      "UPDATE job_pages SET status='scanning',lease_owner='dead-worker',lease_expires_at=? WHERE job_id=? AND page_id=?",
    ).run(liveUntil, job.id, pages[1].page_id);
    expect(repositories.recoverStaleJobs()).toBe(1);
    expect(repositories.recoverStaleJobs()).toBe(0);
    expect(
      db
        .prepare("SELECT status,worker_id,heartbeat_at FROM scan_jobs WHERE id=?")
        .get(job.id) as any,
    ).toMatchObject({
      status: "queued",
      worker_id: null,
      heartbeat_at: null,
    });
    expect(
      db
        .prepare("SELECT status,lease_owner FROM job_pages WHERE page_id=?")
        .get(pages[0].page_id) as any,
    ).toMatchObject({
      status: "discovered",
      lease_owner: null,
    });
    expect(
      db
        .prepare("SELECT status,lease_owner FROM job_pages WHERE page_id=?")
        .get(pages[1].page_id) as any,
    ).toMatchObject({
      status: "scanning",
      lease_owner: "dead-worker",
    });
    db.prepare("UPDATE scan_jobs SET status='completed' WHERE id=?").run(job.id);
  });

  it("writes a page result only for the current lease owner and completes it atomically", () => {
    const site = repositories.upsertSite("https://lease-owner.example");
    const job = repositories.createScanJob(
      site.origin,
      { maxPages: 1, sameOriginOnly: true, respectRobots: true },
      "test",
      "lease-owner-job",
    );
    const leasedJob = repositories.leaseNextJob("owner-worker");
    expect(leasedJob?.id).toBe(job.id);
    repositories.addDiscoveredPages(job.id, site.id, ["https://lease-owner.example/"]);
    const page = repositories.leaseNextPage(job.id, "owner-worker");
    expect(page).not.toBeNull();
    const run = repositories.createRun(job);
    const result = {
      url: "https://lease-owner.example/",
      finalUrl: "https://lease-owner.example/",
      title: "fixture",
      status: 200,
      contentType: "text/html",
      durationMs: 1,
      timestamp: "2026-08-22T00:00:00.000Z",
      testEngine: {},
      testEnvironment: {},
      axeToolOptions: {},
      frameCoverage: {
        frameTotal: 0,
        sameOriginFrameTotal: 0,
        crossOriginFrameTotal: 0,
        frameTestedTotal: 0,
        frameSkippedTotal: 0,
        frameErrorCount: 0,
        status: "no_child_frames",
        issues: [],
      },
      axe: { violations: [], passes: [], incomplete: [], inapplicable: [] },
    };
    expect(() =>
      repositories.savePageResult(run.id, page!.page_id, result, "wrong-worker", 1),
    ).toThrow("页面租约已失效");
    repositories.savePageResult(run.id, page!.page_id, result, "owner-worker", 1);
    const db = dbModule.getDb();
    expect(
      db
        .prepare(
          "SELECT status,lease_owner,lease_expires_at FROM job_pages WHERE job_id=? AND page_id=?",
        )
        .get(job.id, page!.page_id) as any,
    ).toMatchObject({
      status: "completed",
      lease_owner: null,
      lease_expires_at: null,
    });
    expect(
      (db.prepare("SELECT scan_status FROM pages WHERE id=?").get(page!.page_id) as any)
        .scan_status,
    ).toBe("success");
  });

  it("renews the job heartbeat and active page lease together", () => {
    const site = repositories.upsertSite("https://heartbeat.example");
    const job = repositories.createScanJob(
      site.origin,
      { maxPages: 1, sameOriginOnly: true, respectRobots: true },
      "test",
      "heartbeat-job",
    );
    expect(repositories.leaseNextJob("heartbeat-worker")?.id).toBe(job.id);
    repositories.addDiscoveredPages(job.id, site.id, ["https://heartbeat.example/"]);
    const page = repositories.leaseNextPage(job.id, "heartbeat-worker");
    expect(page).not.toBeNull();
    const db = dbModule.getDb();
    db.prepare("UPDATE scan_jobs SET heartbeat_at=? WHERE id=?").run(
      new Date(Date.now() - 10 * 1000).toISOString(),
      job.id,
    );
    // Keep the lease close to expiry while leaving enough margin for a busy CI
    // runner; the heartbeat must still extend it in the same transaction.
    db.prepare("UPDATE job_pages SET lease_expires_at=? WHERE job_id=? AND page_id=?").run(
      new Date(Date.now() + 10 * 1000).toISOString(),
      job.id,
      page!.page_id,
    );
    const before = db.prepare("SELECT heartbeat_at FROM scan_jobs WHERE id=?").get(job.id) as {
      heartbeat_at: string | null;
    };
    const beforeLease = db
      .prepare("SELECT lease_expires_at FROM job_pages WHERE job_id=? AND page_id=?")
      .get(job.id, page!.page_id) as { lease_expires_at: string | null };
    const result = repositories.heartbeatJobAndPage(job.id, "heartbeat-worker", page!.page_id);
    expect(result).toEqual({ jobChanged: true, pageChanged: true });
    const after = db.prepare("SELECT heartbeat_at FROM scan_jobs WHERE id=?").get(job.id) as {
      heartbeat_at: string | null;
    };
    const afterLease = db
      .prepare("SELECT lease_expires_at FROM job_pages WHERE job_id=? AND page_id=?")
      .get(job.id, page!.page_id) as { lease_expires_at: string | null };
    expect(after.heartbeat_at).not.toBe(before.heartbeat_at);
    expect(new Date(afterLease.lease_expires_at!).getTime()).toBeGreaterThan(
      new Date(beforeLease.lease_expires_at!).getTime(),
    );
  });
});
