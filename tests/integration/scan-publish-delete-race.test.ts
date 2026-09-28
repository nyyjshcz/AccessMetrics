import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reportRender = vi.hoisted(() => {
  const render = vi.fn(async (runId: string) => ({
    file: `/private/reports/${runId}/report.html`,
  }));
  return {
    render,
    blockNext() {
      let markStarted!: () => void;
      let releaseRender!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        releaseRender = resolve;
      });
      render.mockImplementation(async (runId: string) => {
        markStarted();
        await gate;
        return { file: `/private/reports/${runId}/report.html` };
      });
      return { started, release: () => releaseRender() };
    },
  };
});

vi.mock("@/lib/report-html", () => ({ renderRunReport: reportRender.render }));

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-publish-delete-race-"));
process.env.APP_ENV = "test";
process.env.DATABASE_URL = path.join(testRoot, "race.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const publishRoute = await import("@/app/api/runs/[runId]/publish/route");
const scanJobRoute = await import("@/app/api/scans/[jobId]/route");

function createCompletedScan(label: string) {
  const job = repositories.createScanJob(`https://${label}.example`, {
    maxPages: 1,
    sameOriginOnly: true,
    respectRobots: true,
  });
  const run = repositories.createRun(job);
  const timestamp = new Date().toISOString();
  const db = dbModule.getDb();
  db.prepare("UPDATE scan_jobs SET status='completed',finished_at=? WHERE id=?").run(
    timestamp,
    job.id,
  );
  db.prepare("UPDATE scan_runs SET status='completed',finished_at=? WHERE id=?").run(
    timestamp,
    run.id,
  );
  return { job, run };
}

function publish(runId: string) {
  return publishRoute.POST(
    new Request(`http://localhost:3000/api/runs/${runId}/publish`, {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
    }),
    { params: Promise.resolve({ runId }) },
  );
}

describe("scan deletion and report publication ordering", () => {
  beforeAll(() => dbModule.migrate());
  beforeEach(() => {
    reportRender.render.mockReset();
    reportRender.render.mockImplementation(async (runId: string) => ({
      file: `/private/reports/${runId}/report.html`,
    }));
  });
  afterAll(() => dbModule.closeDb());

  it("rejects a publish whose report render overlaps a committed deletion fence", async () => {
    const { job, run } = createCompletedScan("publish-after-delete-fence");
    const rendering = reportRender.blockNext();
    const publishing = publish(run.id);

    await rendering.started;
    const deletionRequestedAt = new Date().toISOString();
    dbModule
      .getDb()
      .prepare("UPDATE scan_jobs SET deletion_requested_at=? WHERE id=?")
      .run(deletionRequestedAt, job.id);
    rendering.release();

    const response = await publishing;

    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(409);
    expect(payload.error.code).toBe("SCAN_DELETION_IN_PROGRESS");
    expect(
      dbModule.getDb().prepare("SELECT published FROM scan_runs WHERE id=?").get(run.id),
    ).toEqual({
      published: 0,
    });
    expect(
      dbModule
        .getDb()
        .prepare("SELECT deletion_requested_at FROM scan_jobs WHERE id=?")
        .get(job.id),
    ).toEqual({ deletion_requested_at: deletionRequestedAt });
  });

  it("does not write a deletion fence when publication commits first", async () => {
    const { job, run } = createCompletedScan("delete-after-publish");

    const publishResponse = await publish(run.id);
    expect(publishResponse.status, JSON.stringify(await publishResponse.clone().json())).toBe(200);

    const deleteResponse = await scanJobRoute.DELETE(
      new Request(`http://localhost:3000/api/scans/${job.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ jobId: job.id }) },
    );

    expect(deleteResponse.status).toBe(409);
    expect((await deleteResponse.json()).error.code).toBe("RUN_PUBLISHED_READ_ONLY");
    expect(
      dbModule
        .getDb()
        .prepare("SELECT deletion_requested_at FROM scan_jobs WHERE id=?")
        .get(job.id),
    ).toEqual({ deletion_requested_at: null });
  });
});
