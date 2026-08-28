import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-scans-api-"));
process.env.DATABASE_URL = path.join(testRoot, "scans-api.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const scansRoute = await import("@/app/api/scans/route");

describe("scans list route", () => {
  beforeAll(() => dbModule.migrate());
  afterAll(() => dbModule.closeDb());

  it("allows absent or matching Origin and rejects cross-origin mutations", async () => {
    const crossOrigin = await scansRoute.POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { Origin: "https://attacker.example", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(crossOrigin.status).toBe(403);
    expect((await crossOrigin.json()).error).toMatchObject({ code: "ORIGIN_MISMATCH" });

    const malformedOrigin = await scansRoute.POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { Origin: "not-an-origin", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(malformedOrigin.status).toBe(403);

    const absentOrigin = await scansRoute.POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(absentOrigin.status).toBe(422);

    const matchingOrigin = await scansRoute.POST(
      new Request("http://localhost:3000/api/scans", {
        method: "POST",
        headers: { Origin: "http://localhost:3000", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(matchingOrigin.status).toBe(422);
  });

  it("includes queued, running, and failed jobs without runs in the active view", async () => {
    const queued = repositories.createScanJob("https://queued-list.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const running = repositories.createScanJob("https://running-list.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const failed = repositories.createScanJob("https://failed-list.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const db = dbModule.getDb();
    db.prepare("UPDATE scan_jobs SET status='running' WHERE id=?").run(running.id);
    db.prepare("UPDATE scan_jobs SET status='failed',finished_at=? WHERE id=?").run(
      new Date().toISOString(),
      failed.id,
    );

    const publishedJob = repositories.createScanJob("https://published-list.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const publishedRun = repositories.createRun(publishedJob);
    db.prepare("UPDATE scan_runs SET status='completed',published=1 WHERE id=?").run(
      publishedRun.id,
    );

    const activeResponse = await scansRoute.GET(
      new Request("http://localhost/api/scans?view=active"),
    );
    expect(activeResponse.status).toBe(200);
    const activeRows = (await activeResponse.json()).runs as Array<Record<string, unknown>>;
    expect(new Set(activeRows.map((row) => row.job_id))).toEqual(
      new Set([queued.id, running.id, failed.id]),
    );
    expect(activeRows.find((row) => row.job_id === queued.id)).toMatchObject({
      run_id: null,
      run_status: null,
      job_status: "queued",
    });

    const publishedResponse = await scansRoute.GET(
      new Request("http://localhost/api/scans?view=published"),
    );
    expect(publishedResponse.status).toBe(200);
    expect((await publishedResponse.json()).runs).toEqual([
      expect.objectContaining({ run_id: publishedRun.id, published: 1 }),
    ]);
  });
});
