import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accessmetrics-ai-lifecycle-"));
process.env.APP_ENV = "test";
process.env.DATABASE_URL = path.join(testRoot, "ai-lifecycle.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");
process.env.SESSION_SECRET = "ai-lifecycle-test-session-secret-0123456789";

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const ai = await import("@/lib/ai-overlay");
const providerRoute = await import("@/app/api/ai/providers/[providerId]/route");
const batchRoute = await import("@/app/api/ai/batches/[batchId]/route");
const reviewRoute = await import("@/app/api/runs/[runId]/ai-review/route");

function fixture(nodeCount = 2) {
  const origin = `https://ai-lifecycle-${crypto.randomUUID()}.example`;
  const site = repositories.upsertSite(origin);
  const job = repositories.createScanJob(origin, {
    maxPages: 1,
    sameOriginOnly: true,
    respectRobots: true,
  });
  const run = repositories.createRun(job);
  const pageId = `page_${crypto.randomUUID()}`;
  dbModule
    .getDb()
    .prepare("INSERT INTO pages(id,site_id,canonical_url,first_seen_at) VALUES (?,?,?,?)")
    .run(pageId, site.id, `${origin}/`, new Date().toISOString());
  repositories.savePageResult(run.id, pageId, {
    url: `${origin}/`,
    finalUrl: `${origin}/`,
    title: "AI lifecycle fixture",
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
          nodes: Array.from({ length: nodeCount }, (_, index) => ({
            html: `<img data-lifecycle="${index}">`,
            target: [`img[data-lifecycle="${index}"]`],
            any: [],
            all: [],
            none: [],
          })),
        },
      ],
      inapplicable: [],
    },
  });
  return { job, run };
}

function provider(model = "model-a") {
  return ai.saveAiProvider({
    label: "Lifecycle provider",
    baseUrl: "http://127.0.0.1:1234/v1",
    model,
    apiKey: "local-test-key",
    enabled: true,
  });
}

function postReview(runId: string, providerConfigId: string) {
  return reviewRoute.POST(
    new Request(`http://localhost/api/runs/${runId}/ai-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerConfigId }),
    }),
    { params: Promise.resolve({ runId }) },
  );
}

function postBatchAction(batchId: string, action: "pause" | "resume" | "retry") {
  return batchRoute.POST(
    new Request(`http://localhost/api/ai/batches/${batchId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ batchId }) },
  );
}

describe("AI lifecycle integration", () => {
  beforeAll(() => dbModule.migrate());
  afterAll(() => dbModule.closeDb());

  it.each(["material edit", "disable", "delete"] as const)(
    "%s cancels unresolved provider work and preserves completed and manual data",
    async (change) => {
      const { run } = fixture(2);
      const configured = provider();
      const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
      const db = dbModule.getDb();
      const items = db
        .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
        .all(created.batch.id) as Array<{ id: string }>;
      db.prepare(
        "UPDATE ai_review_items SET status='completed',verdict='problem',completed_at=?,updated_at=? WHERE id=?",
      ).run(new Date().toISOString(), new Date().toISOString(), items[0].id);
      db.prepare("UPDATE ai_review_batches SET status='running' WHERE id=?").run(created.batch.id);
      db.prepare("UPDATE ai_review_items SET status='running',attempt_count=1,lease_owner='w',lease_until=? WHERE id=?")
        .run(new Date(Date.now() + 60_000).toISOString(), items[1].id);
      db.prepare(
        "INSERT INTO ai_api_attempts(id,worker_id,slot,run_id,batch_id,item_id,provider_config_id,provider_label,model,retry_cycle,attempt_number,started_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'running')",
      ).run(`attempt_${crypto.randomUUID()}`, "w", 0, run.id, created.batch.id, items[1].id, configured.id, configured.label, configured.model, 0, 1, new Date().toISOString());
      const manualNodeId = db
        .prepare("SELECT result_node_id FROM ai_review_items WHERE id=?")
        .get(items[0].id) as { result_node_id: string };
      db.prepare(
        "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,NULL,'ad_hoc','local','uncertain','keep',1,1,?)",
      ).run(`manual_${crypto.randomUUID()}`, manualNodeId.result_node_id, new Date().toISOString());
      const exportId = `export_${crypto.randomUUID()}`;
      db.prepare("INSERT INTO exports(id,run_id,kind,path,manifest_hash,created_at,status) VALUES (?,?,'json','keep.json','hash',?,'completed')")
        .run(exportId, run.id, new Date().toISOString());

      if (change === "material edit") {
        const response = await providerRoute.PATCH(
          new Request(`http://localhost/api/ai/providers/${configured.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: "model-b", label: configured.label, baseUrl: configured.baseUrl }),
          }),
          { params: Promise.resolve({ providerId: configured.id }) },
        );
        expect(response.status, await response.clone().text()).toBe(200);
      } else if (change === "disable") {
        const response = await providerRoute.PATCH(
          new Request(`http://localhost/api/ai/providers/${configured.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: false, label: configured.label, baseUrl: configured.baseUrl, model: configured.model }),
          }),
          { params: Promise.resolve({ providerId: configured.id }) },
        );
        expect(response.status, await response.clone().text()).toBe(200);
      } else {
        const response = await providerRoute.DELETE(
          new Request(`http://localhost/api/ai/providers/${configured.id}`, { method: "DELETE" }),
          { params: Promise.resolve({ providerId: configured.id }) },
        );
        expect(response.status, await response.clone().text()).toBe(200);
      }

      expect(db.prepare("SELECT status,verdict FROM ai_review_items WHERE id=?").get(items[0].id)).toEqual({
        status: "completed",
        verdict: "problem",
      });
      expect(db.prepare("SELECT id FROM ai_review_items WHERE id=?").get(items[1].id)).toBeUndefined();
      expect(db.prepare("SELECT status,cancel_requested_at FROM ai_review_batches WHERE id=?").get(created.batch.id)).toMatchObject({
        status: "cancelled",
        cancel_requested_at: expect.any(String),
      });
      expect(db.prepare("SELECT cancelled_at FROM ai_api_attempts WHERE item_id=?").get(items[1].id)).toMatchObject({
        cancelled_at: expect.any(String),
      });
      expect(db.prepare("SELECT note,is_current FROM manual_reviews WHERE result_node_id=?").get(manualNodeId.result_node_id)).toEqual({ note: "keep", is_current: 1 });
      expect(db.prepare("SELECT id FROM exports WHERE id=?").get(exportId)).toBeDefined();
    },
  );

  it("does not duplicate or reset work when provider edits leave its snapshot unchanged", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    const db = dbModule.getDb();
    db.prepare("UPDATE ai_review_items SET attempt_count=2,retry_cycle=1 WHERE batch_id=?").run(batchId);

    const edited = await providerRoute.PATCH(
      new Request(`http://localhost/api/ai/providers/${configured.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Lifecycle provider", baseUrl: configured.baseUrl, model: configured.model }),
      }),
      { params: Promise.resolve({ providerId: configured.id }) },
    );
    expect(edited.status).toBe(200);
    const repeated = await postReview(run.id, configured.id);
    expect(repeated.status).toBe(201);
    expect((await repeated.json()).batch.id).toBe(batchId);
    expect(db.prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=?").get(run.id)).toEqual({ count: 1 });
    expect(db.prepare("SELECT attempt_count,retry_cycle FROM ai_review_items WHERE batch_id=?").get(batchId)).toEqual({ attempt_count: 2, retry_cycle: 1 });
  });

  it("allows a fresh explicit review after an invalidated provider is re-enabled", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const oldBatchId = (await started.json()).batch.id as string;
    const disabled = await providerRoute.PATCH(
      new Request(`http://localhost/api/ai/providers/${configured.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          label: configured.label,
          baseUrl: configured.baseUrl,
          model: configured.model,
        }),
      }),
      { params: Promise.resolve({ providerId: configured.id }) },
    );
    expect(disabled.status).toBe(200);
    const enabled = await providerRoute.PATCH(
      new Request(`http://localhost/api/ai/providers/${configured.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          label: configured.label,
          baseUrl: configured.baseUrl,
          model: configured.model,
        }),
      }),
      { params: Promise.resolve({ providerId: configured.id }) },
    );
    expect(enabled.status).toBe(200);

    const restarted = await postReview(run.id, configured.id);
    expect(restarted.status).toBe(201);
    expect((await restarted.json()).batch.id).not.toBe(oldBatchId);
    expect(
      dbModule
        .getDb()
        .prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=? AND status IN ('queued','running')")
        .get(run.id),
    ).toEqual({ count: 1 });
  });

  it("switches the active run to one batch for the explicitly selected new model", async () => {
    const { run } = fixture(2);
    const firstProvider = provider("model-a");
    const secondProvider = provider("model-b");
    const firstResponse = await postReview(run.id, firstProvider.id);
    const oldBatchId = (await firstResponse.json()).batch.id as string;
    expect((await postBatchAction(oldBatchId, "pause")).status).toBe(200);

    const switched = await postReview(run.id, secondProvider.id);
    expect(switched.status, await switched.clone().text()).toBe(201);
    const newBatchId = (await switched.json()).batch.id as string;
    expect(newBatchId).not.toBe(oldBatchId);
    const db = dbModule.getDb();
    expect(db.prepare("SELECT status,cancel_requested_at FROM ai_review_batches WHERE id=?").get(oldBatchId)).toMatchObject({
      status: "cancelled",
      cancel_requested_at: expect.any(String),
    });
    expect(db.prepare("SELECT COUNT(*) count FROM ai_review_items WHERE batch_id=?").get(oldBatchId)).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=? AND status IN ('queued','running')").get(run.id)).toEqual({ count: 1 });
  });

  it("pauses, then explicitly resumes an unchanged snapshot without resetting consumed attempts", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    const db = dbModule.getDb();
    db.prepare("UPDATE ai_review_items SET attempt_count=2,retry_cycle=1 WHERE batch_id=?").run(batchId);

    const paused = await postBatchAction(batchId, "pause");
    expect(paused.status).toBe(200);
    expect((await paused.json()).batch.status).toBe("paused");
    expect(db.prepare("SELECT status FROM ai_review_items WHERE batch_id=?").get(batchId)).toEqual({ status: "queued" });
    const resumed = await postBatchAction(batchId, "resume");
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).batch.status).toBe("queued");
    expect(db.prepare("SELECT attempt_count,retry_cycle FROM ai_review_items WHERE batch_id=?").get(batchId)).toEqual({ attempt_count: 2, retry_cycle: 1 });
  });

  it("aborts an in-flight request on pause and resumes the queued item in the same attempt cycle", async () => {
    const { run } = fixture(1);
    const db = dbModule.getDb();
    db.prepare("UPDATE ai_review_batches SET status='paused' WHERE status IN ('queued','running','failed')").run();
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    let requestSignal: AbortSignal | undefined;
    let rejectFetch: ((reason?: unknown) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          rejectFetch = reject;
          requestSignal = init?.signal as AbortSignal;
          requestSignal.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    let processing: Promise<boolean> | undefined;
    try {
      processing = ai.processNextAiItem("pause-worker");
      for (let wait = 0; wait < 50 && !requestSignal; wait += 1)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(requestSignal).toBeDefined();

      const paused = await postBatchAction(batchId, "pause");
      expect(paused.status).toBe(200);
      expect((await paused.json()).batch.status).toBe("paused");
      await expect(processing).resolves.toBe(true);
      expect(requestSignal?.aborted).toBe(true);
      expect(db.prepare("SELECT status,attempt_count,retry_cycle,lease_owner,lease_until FROM ai_review_items WHERE batch_id=?").get(batchId)).toMatchObject({
        status: "queued",
        attempt_count: 1,
        retry_cycle: 0,
        lease_owner: null,
        lease_until: null,
      });
      expect(db.prepare("SELECT status,cancelled_at FROM ai_api_attempts WHERE batch_id=?").get(batchId)).toMatchObject({
        status: "cancelled",
        cancelled_at: expect.any(String),
      });

      const resumed = await postBatchAction(batchId, "resume");
      expect(resumed.status).toBe(200);
      await resumed.json();
      expect(db.prepare("SELECT attempt_count,retry_cycle FROM ai_review_items WHERE batch_id=?").get(batchId)).toEqual({
        attempt_count: 1,
        retry_cycle: 0,
      });
    } finally {
      if (processing && requestSignal && !requestSignal.aborted)
        rejectFetch?.(new DOMException("Test cleanup", "AbortError"));
      await processing?.catch(() => undefined);
      fetchSpy.mockRestore();
    }
  });

  it("does not issue a duplicate call when a cross-container pause is resumed before abort settles", async () => {
    const { run } = fixture(1);
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_batches SET status='paused' WHERE status IN ('queued','running','failed')")
      .run();
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    let requestSignal: AbortSignal | undefined;
    let resolveFetch: ((response: Response) => void) | undefined;
    let rejectFetch: ((reason?: unknown) => void) | undefined;
    let fetchCalls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      fetchCalls += 1;
      if (fetchCalls > 1)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ verdict: "uncertain", reason: "test" }) } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      return new Promise<Response>((resolve, reject) => {
        resolveFetch = resolve;
        rejectFetch = reject;
        requestSignal = init?.signal as AbortSignal;
        requestSignal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const abortSpy = vi.spyOn(AbortController.prototype, "abort").mockImplementation(() => {});
    let processing: Promise<boolean> | undefined;
    try {
      processing = ai.processNextAiItem("remote-worker-slot");
      for (let wait = 0; wait < 50 && !requestSignal; wait += 1)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(requestSignal).toBeDefined();

      // Model a Web container recording the durable cancel request. Its local
      // aborter cannot reach the request owned by the separate AI Worker.
      const paused = await postBatchAction(batchId, "pause");
      expect(paused.status).toBe(200);
      expect((await paused.json()).batch.status).toBe("paused");
      expect(dbModule.getDb().prepare(
        "SELECT status,lease_owner,lease_until FROM ai_review_items WHERE batch_id=?",
      ).get(batchId)).toMatchObject({
        status: "running",
        lease_owner: "remote-worker-slot",
        lease_until: expect.any(String),
      });

      const resumed = await postBatchAction(batchId, "resume");
      expect(resumed.status).toBe(200);
      expect((await resumed.json()).batch.status).toBe("queued");
      await expect(ai.processNextAiItem("second-worker-slot")).resolves.toBe(false);
      expect(fetchCalls).toBe(1);

      // A provider can still deliver a response after the durable cancel was
      // recorded. Discard it, release the old lease, then allow one new call.
      resolveFetch?.(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ verdict: "uncertain", reason: "late" }) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await expect(processing).resolves.toBe(true);
      expect(dbModule.getDb().prepare(
        "SELECT status,attempt_count,lease_owner,verdict FROM ai_review_items WHERE batch_id=?",
      ).get(batchId)).toMatchObject({
        status: "queued",
        attempt_count: 1,
        lease_owner: null,
        verdict: null,
      });
      await expect(ai.processNextAiItem("after-cancel-settled-worker")).resolves.toBe(true);
      expect(fetchCalls).toBe(2);
      expect(dbModule.getDb().prepare(
        "SELECT status,attempt_count,verdict FROM ai_review_items WHERE batch_id=?",
      ).get(batchId)).toMatchObject({ status: "completed", attempt_count: 2, verdict: "uncertain" });
    } finally {
      abortSpy.mockRestore();
      if (processing && requestSignal && !requestSignal.aborted) {
        ai.pauseAiBatch(batchId);
        rejectFetch?.(new DOMException("Test cleanup", "AbortError"));
      }
      await processing?.catch(() => undefined);
      fetchSpy.mockRestore();
    }
  });

  it("rejects resume after its provider snapshot becomes stale", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    expect((await postBatchAction(batchId, "pause")).status).toBe(200);
    const edit = await providerRoute.PATCH(
      new Request(`http://localhost/api/ai/providers/${configured.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: configured.label, baseUrl: configured.baseUrl, model: "model-changed" }),
      }),
      { params: Promise.resolve({ providerId: configured.id }) },
    );
    expect(edit.status, await edit.clone().text()).toBe(200);
    const resumed = await postBatchAction(batchId, "resume");
    expect(resumed.status).toBe(409);
    expect((await resumed.json()).error.code).toBe("AI_BATCH_CANCELLED");
  });

  it("rejects resuming a batch after its source scan becomes immutable", async () => {
    const { job, run } = fixture(1);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    expect((await postBatchAction(batchId, "pause")).status).toBe(200);
    dbModule.getDb().prepare("UPDATE scan_runs SET published=1,status='completed' WHERE id=?").run(run.id);
    dbModule.getDb().prepare("UPDATE scan_jobs SET status='completed',finished_at=? WHERE id=?").run(new Date().toISOString(), job.id);

    const resumed = await postBatchAction(batchId, "resume");
    expect(resumed.status).toBe(409);
    expect((await resumed.json()).error.code).toBe("RUN_PUBLISHED_READ_ONLY");
  });

  it("rejects starting work for a missing or immutable scan", async () => {
    const configured = provider();
    const missing = await postReview("missing-run", configured.id);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("RUN_NOT_FOUND");

    const { job, run } = fixture(1);
    dbModule.getDb().prepare("UPDATE scan_runs SET published=1,status='completed' WHERE id=?").run(run.id);
    dbModule.getDb().prepare("UPDATE scan_jobs SET status='completed',finished_at=? WHERE id=?").run(new Date().toISOString(), job.id);
    const immutable = await postReview(run.id, configured.id);
    expect(immutable.status).toBe(409);
    expect((await immutable.json()).error.code).toBe("RUN_PUBLISHED_READ_ONLY");
  });

  it("reports explicit retry count and advances only failed item cycles", async () => {
    const { run } = fixture(2);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    const db = dbModule.getDb();
    const rows = db.prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id").all(batchId) as Array<{ id: string }>;
    db.prepare("UPDATE ai_review_items SET status='failed',attempt_count=3,retry_cycle=0,completed_at=? WHERE id=?").run(new Date().toISOString(), rows[0].id);
    db.prepare("UPDATE ai_review_items SET status='completed',verdict='problem' WHERE id=?").run(rows[1].id);
    db.prepare("UPDATE ai_review_batches SET status='failed' WHERE id=?").run(batchId);

    const retried = await postBatchAction(batchId, "retry");
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ retriedCount: 1, batch: { status: "queued" } });
    expect(db.prepare("SELECT status,attempt_count,retry_cycle FROM ai_review_items WHERE id=?").get(rows[0].id)).toEqual({ status: "queued", attempt_count: 0, retry_cycle: 1 });
    expect(db.prepare("SELECT status,attempt_count,retry_cycle,verdict FROM ai_review_items WHERE id=?").get(rows[1].id)).toEqual({ status: "completed", attempt_count: 0, retry_cycle: 0, verdict: "problem" });
  });

  it("does not count a failed item that a human review resolves before retry", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    const db = dbModule.getDb();
    const item = db
      .prepare("SELECT id,result_node_id FROM ai_review_items WHERE batch_id=?")
      .get(batchId) as { id: string; result_node_id: string };
    const timestamp = new Date().toISOString();
    db.prepare(
      "UPDATE ai_review_items SET status='failed',attempt_count=3,completed_at=? WHERE id=?",
    ).run(timestamp, item.id);
    db.prepare("UPDATE ai_review_batches SET status='failed' WHERE id=?").run(batchId);
    db.prepare(
      "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,NULL,'ad_hoc','local','not_problem','resolved manually',1,1,?)",
    ).run(`manual_${crypto.randomUUID()}`, item.result_node_id, timestamp);

    const retried = await postBatchAction(batchId, "retry");

    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ retriedCount: 0, batch: { status: "completed" } });
    expect(db.prepare("SELECT COUNT(*) count FROM ai_review_items WHERE id=?").get(item.id)).toEqual({ count: 0 });
  });

  it("does not make a provider call when explicit resume finds an exhausted cycle", async () => {
    const { run } = fixture(1);
    const db = dbModule.getDb();
    db.prepare("UPDATE ai_review_batches SET status='paused' WHERE status IN ('queued','running','failed')").run();
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    db.prepare("UPDATE ai_review_items SET attempt_count=3,retry_cycle=2 WHERE batch_id=?").run(batchId);
    expect((await postBatchAction(batchId, "pause")).status).toBe(200);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("unexpected fake provider request in exhausted-cycle test"),
    );
    try {
      const resumed = await postBatchAction(batchId, "resume");
      expect(resumed.status).toBe(200);
      expect((await resumed.json()).batch.status).toBe("failed");
      expect(db.prepare("SELECT status,attempt_count,retry_cycle,last_error FROM ai_review_items WHERE batch_id=?").get(batchId)).toEqual({
        status: "failed",
        attempt_count: 3,
        retry_cycle: 2,
        last_error: "AI_ATTEMPTS_EXHAUSTED",
      });
      await expect(ai.processNextAiItem("exhausted-cycle-worker")).resolves.toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
