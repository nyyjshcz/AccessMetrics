import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-scans-api-"));
process.env.DATABASE_URL = path.join(testRoot, "scans-api.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");
process.env.SESSION_SECRET = "scans-api-test-session-secret-0123456789";

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const scansRoute = await import("@/app/api/scans/route");
const scanJobRoute = await import("@/app/api/scans/[jobId]/route");
const ai = await import("@/lib/ai-overlay");

function saveIncompleteForDelete(runId: string, siteId: string, origin: string) {
  const pageId = `page_delete_${Math.random().toString(36).slice(2)}`;
  const db = dbModule.getDb();
  db.prepare("INSERT INTO pages(id,site_id,canonical_url,first_seen_at) VALUES (?,?,?,?)").run(
    pageId,
    siteId,
    `${origin}/`,
    new Date().toISOString(),
  );
  repositories.savePageResult(runId, pageId, {
    url: `${origin}/`,
    finalUrl: `${origin}/`,
    title: "删除测试页面",
    status: 200,
    durationMs: 1,
    axe: {
      passes: [],
      violations: [],
      incomplete: [
        {
          id: "image-alt",
          impact: "serious",
          tags: ["wcag111"],
          description: "Image alternative text",
          help: "Images must have alternate text",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
          nodes: [{ html: "<img>", target: ["img"], any: [], all: [], none: [] }],
        },
      ],
      inapplicable: [],
    },
  });
  return pageId;
}

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

    const crossOriginDelete = await scanJobRoute.DELETE(
      new Request("http://localhost/api/scans/missing", {
        method: "DELETE",
        headers: { Origin: "https://attacker.example" },
      }),
      { params: Promise.resolve({ jobId: "missing" }) },
    );
    expect(crossOriginDelete.status).toBe(403);
    expect((await crossOriginDelete.json()).error).toMatchObject({ code: "ORIGIN_MISMATCH" });

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

  it("deletes a terminal unpublished scan with active AI work and all local runtime data", async () => {
    const origin = `https://delete-terminal-${Math.random().toString(36).slice(2)}.example`;
    const job = repositories.createScanJob(origin, {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const run = repositories.createRun(job);
    saveIncompleteForDelete(run.id, job.site_id, origin);
    const db = dbModule.getDb();
    const node = db
      .prepare(
        "SELECT n.id FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id WHERE rr.run_id=?",
      )
      .get(run.id) as { id: string };
    const provider = ai.saveAiProvider({
      label: "删除测试模型",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "delete-test-model",
      apiKey: "delete-test-key",
      maxConcurrentRequests: 1,
      enabled: true,
    });
    const batch = ai.createAiBatch({ runId: run.id, providerConfigId: provider.id });
    db.prepare(
      "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,supersedes_review_id,is_current,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      `manual_delete_${Math.random().toString(36).slice(2)}`,
      node.id,
      null,
      "ad_hoc",
      "local",
      "uncertain",
      "删除测试备注",
      1,
      null,
      1,
      new Date().toISOString(),
    );
    db.prepare("UPDATE scan_jobs SET status='completed',finished_at=? WHERE id=?").run(
      new Date().toISOString(),
      job.id,
    );

    const response = await scanJobRoute.DELETE(
      new Request(`http://localhost:3000/api/scans/${job.id}`, {
        method: "DELETE",
        headers: { Origin: "http://localhost:3000" },
      }),
      { params: Promise.resolve({ jobId: job.id }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, jobId: job.id, runId: run.id });
    expect(batch.stats.queued).toBe(1);
    for (const [table, column, value] of [
      ["scan_jobs", "id", job.id],
      ["scan_runs", "id", run.id],
      ["rule_results", "run_id", run.id],
      ["result_nodes", "id", node.id],
      ["ai_review_batches", "id", batch.batch.id],
      ["ai_review_items", "batch_id", batch.batch.id],
      ["manual_reviews", "result_node_id", node.id],
    ] as const) {
      expect(
        db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column}=?`).get(value),
      ).toEqual({
        count: 0,
      });
    }
    expect(
      db.prepare("SELECT COUNT(*) count FROM ai_provider_configs WHERE id=?").get(provider.id),
    ).toEqual({
      count: 1,
    });

    const activeResponse = await scansRoute.GET(
      new Request("http://localhost/api/scans?view=active"),
    );
    expect((await activeResponse.json()).runs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ job_id: job.id })]),
    );
  });

  it("allows every terminal job without a run to be deleted", async () => {
    const db = dbModule.getDb();
    for (const status of ["completed", "failed", "cancelled"]) {
      const job = repositories.createScanJob(`https://delete-${status}-${Math.random()}.example`, {
        maxPages: 1,
        sameOriginOnly: true,
        respectRobots: true,
      });
      db.prepare("UPDATE scan_jobs SET status=?,finished_at=? WHERE id=?").run(
        status,
        new Date().toISOString(),
        job.id,
      );
      const response = await scanJobRoute.DELETE(
        new Request(`http://localhost:3000/api/scans/${job.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ jobId: job.id }) },
      );
      expect(response.status).toBe(200);
      expect(db.prepare("SELECT id FROM scan_jobs WHERE id=?").get(job.id)).toBeUndefined();
    }
  });

  it("refuses nonterminal, published, and study-referenced tasks", async () => {
    const db = dbModule.getDb();
    for (const status of ["queued", "running", "paused"]) {
      const job = repositories.createScanJob(`https://keep-${status}-${Math.random()}.example`, {
        maxPages: 1,
        sameOriginOnly: true,
        respectRobots: true,
      });
      db.prepare("UPDATE scan_jobs SET status=? WHERE id=?").run(status, job.id);
      const response = await scanJobRoute.DELETE(
        new Request(`http://localhost:3000/api/scans/${job.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ jobId: job.id }) },
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatchObject({ code: "SCAN_JOB_NOT_TERMINAL" });
      expect(db.prepare("SELECT id FROM scan_jobs WHERE id=?").get(job.id)).toBeDefined();
    }

    const publishedJob = repositories.createScanJob(
      `https://keep-published-${Math.random()}.example`,
      {
        maxPages: 1,
        sameOriginOnly: true,
        respectRobots: true,
      },
    );
    const publishedRun = repositories.createRun(publishedJob);
    db.prepare("UPDATE scan_jobs SET status='completed' WHERE id=?").run(publishedJob.id);
    db.prepare("UPDATE scan_runs SET status='completed',published=1 WHERE id=?").run(
      publishedRun.id,
    );
    const publishedResponse = await scanJobRoute.DELETE(
      new Request(`http://localhost:3000/api/scans/${publishedJob.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ jobId: publishedJob.id }) },
    );
    expect(publishedResponse.status).toBe(409);
    expect((await publishedResponse.json()).error).toMatchObject({
      code: "RUN_PUBLISHED_READ_ONLY",
    });

    const studyJob = repositories.createScanJob(`https://keep-study-${Math.random()}.example`, {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const studyRun = repositories.createRun(studyJob);
    const campaignId = `campaign_delete_${Math.random().toString(36).slice(2)}`;
    db.prepare(
      "INSERT INTO study_campaigns(id,campaign_plan_hash,protocol_hash,sample_frame_hash,baseline_triple_json,target_site_count,page_limit,retry_policy_json,replacement_policy_json,allowed_failure_reason_codes_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      campaignId,
      `plan_${campaignId}`,
      `protocol_${campaignId}`,
      `frame_${campaignId}`,
      "{}",
      10,
      1,
      "{}",
      "{}",
      "[]",
      "active",
      new Date().toISOString(),
    );
    db.prepare(
      "INSERT INTO study_run_attempts(id,campaign_id,slot,candidate_id,replacement_rank,attempt_no,run_id,trigger,terminal_status,usability_decision,started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      `attempt_${campaignId}`,
      campaignId,
      0,
      `candidate_${campaignId}`,
      0,
      1,
      studyRun.id,
      "manual",
      "completed",
      "usable",
      new Date().toISOString(),
    );
    db.prepare("UPDATE scan_jobs SET status='completed' WHERE id=?").run(studyJob.id);
    const studyResponse = await scanJobRoute.DELETE(
      new Request(`http://localhost:3000/api/scans/${studyJob.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ jobId: studyJob.id }) },
    );
    expect(studyResponse.status).toBe(409);
    expect((await studyResponse.json()).error).toMatchObject({ code: "SCAN_STUDY_REFERENCED" });
    expect(db.prepare("SELECT id FROM scan_runs WHERE id=?").get(studyRun.id)).toBeDefined();
  });

  it("returns a localized pre-discovery failure separately from page progress", async () => {
    const job = repositories.createScanJob("https://discovery-failure-api.example", {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE scan_jobs SET status='failed',finished_at=?,error_code=?,error_message=? WHERE id=?",
    ).run(new Date().toISOString(), "DNS_LOOKUP_FAILED", "raw lookup detail", job.id);

    const response = await scanJobRoute.GET(
      new Request(`http://localhost/api/scans/${job.id}?lang=en`),
      { params: Promise.resolve({ jobId: job.id }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      job: { id: job.id, status: "failed", error_code: "DNS_LOOKUP_FAILED" },
      progress: { discovered: 0, failed: 0 },
      failure: {
        code: "DNS_LOOKUP_FAILED",
        message: "The target domain could not be resolved",
      },
    });

    db.prepare("UPDATE scan_jobs SET error_code=?,error_message=? WHERE id=?").run(
      "INTERNAL_RESOLVER_DETAIL",
      "secret resolver internals",
      job.id,
    );
    const unknownResponse = await scanJobRoute.GET(
      new Request(`http://localhost/api/scans/${job.id}?lang=en`),
      { params: Promise.resolve({ jobId: job.id }) },
    );
    expect((await unknownResponse.json()).failure).toEqual({
      code: "INTERNAL_RESOLVER_DETAIL",
      message: "The scan failed before page discovery",
    });
  });
});
