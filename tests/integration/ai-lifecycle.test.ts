import fs from "node:fs";
import http from "node:http";
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
const aiOverlayComponent = await import("@/components/ai-overlay-card");

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

function postReview(
  runId: string,
  providerConfigId: string,
  options: { mode?: "remaining" | "all"; requestId?: string; sourceBatchId?: string } = {},
) {
  return reviewRoute.POST(
    new Request(`http://localhost/api/runs/${runId}/ai-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerConfigId,
        mode: options.mode ?? "all",
        requestId: options.requestId ?? crypto.randomUUID(),
        ...(options.sourceBatchId ? { sourceBatchId: options.sourceBatchId } : {}),
      }),
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

  it("increments the batch revision only when pause changes an active batch", () => {
    const { run } = fixture(1);
    const configured = provider();
    const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
    expect(created.batch.revision).toBe(0);

    const paused = ai.pauseAiBatch(created.batch.id);
    expect(paused.batch).toMatchObject({ status: "paused", revision: 1 });
    expect(ai.pauseAiBatch(created.batch.id).batch.revision).toBe(1);
  });

  it("deduplicates a replayed action request but gives a second all action a fresh batch", async () => {
    const { run } = fixture(2);
    const configured = provider();
    const requestId = crypto.randomUUID();
    const concurrentResponses = await Promise.all([
      postReview(run.id, configured.id, { mode: "all", requestId }),
      postReview(run.id, configured.id, { mode: "all", requestId }),
    ]);
    const concurrentResults = await Promise.all(
      concurrentResponses.map((response) => response.json()),
    );
    expect(concurrentResponses.map((response) => response.status)).toEqual([201, 201]);
    expect(concurrentResults[0].batch.id).toBe(concurrentResults[1].batch.id);
    expect(
      dbModule
        .getDb()
        .prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=?")
        .get(run.id),
    ).toEqual({ count: 1 });
    const first = concurrentResults[0];

    ai.pauseAiBatch(first.batch.id);
    const secondResponse = await postReview(run.id, configured.id, {
      mode: "all",
      requestId: crypto.randomUUID(),
    });
    const second = await secondResponse.json();
    expect(second.batch.id).not.toBe(first.batch.id);
    expect(second.stats.total).toBe(2);
    expect(
      dbModule
        .getDb()
        .prepare("SELECT status,stop_reason,stop_requested_at FROM ai_review_batches WHERE id=?")
        .get(first.batch.id),
    ).toMatchObject({
      status: "cancelled",
      stop_reason: "superseded",
      stop_requested_at: expect.any(String),
    });
    expect(
      dbModule
        .getDb()
        .prepare("SELECT COUNT(*) count FROM ai_review_items WHERE batch_id=?")
        .get(first.batch.id),
    ).toEqual({ count: 2 });
    ai.pauseAiBatch(second.batch.id);
  });

  it("records pause reason and clears it when an administrator resumes the batch", () => {
    const { run } = fixture(1);
    const configured = provider();
    const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });

    const paused = ai.pauseAiBatch(created.batch.id);
    expect(paused.batch).toMatchObject({
      status: "paused",
      stop_reason: "paused",
      stop_requested_at: expect.any(String),
    });

    const resumed = ai.resumeAiBatch(created.batch.id);
    expect(resumed.batch).toMatchObject({
      status: "queued",
      stop_reason: null,
      stop_requested_at: null,
      cancel_requested_at: null,
    });
    ai.pauseAiBatch(created.batch.id);
  });

  it("clears pause metadata when explicit resume finds no remaining work", () => {
    const { run } = fixture(1);
    const configured = provider();
    const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
    ai.pauseAiBatch(created.batch.id);
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_items SET status='completed',verdict='uncertain' WHERE batch_id=?")
      .run(created.batch.id);

    const resumed = ai.resumeAiBatch(created.batch.id);
    expect(resumed.batch).toMatchObject({
      status: "completed",
      stop_reason: null,
      stop_requested_at: null,
      cancel_requested_at: null,
    });
  });

  it("rejects reusing an action request ID for a different operation", async () => {
    const { run } = fixture(2);
    const configured = provider("model-a");
    const alternate = provider("model-b");
    const requestId = crypto.randomUUID();
    const original = await postReview(run.id, configured.id, { mode: "all", requestId });
    expect(original.status).toBe(201);

    const changedMode = await postReview(run.id, configured.id, {
      mode: "remaining",
      requestId,
    });
    expect(changedMode.status).toBe(409);
    expect(await changedMode.json()).toMatchObject({
      error: { code: "AI_BATCH_REQUEST_CONFLICT" },
    });

    const changedProvider = await postReview(run.id, alternate.id, {
      mode: "all",
      requestId,
    });
    expect(changedProvider.status).toBe(409);
    expect(await changedProvider.json()).toMatchObject({
      error: { code: "AI_BATCH_REQUEST_CONFLICT" },
    });
    expect(
      dbModule
        .getDb()
        .prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=?")
        .get(run.id),
    ).toEqual({ count: 1 });
    const originalBatch = (await original.json()).batch;
    ai.pauseAiBatch(originalBatch.id);
  });

  it("rejects remaining requests without a source batch instead of treating them as all", async () => {
    const { run } = fixture(2);
    const configured = provider();
    const response = await postReview(run.id, configured.id, {
      mode: "remaining",
      requestId: crypto.randomUUID(),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AI_BATCH_SOURCE_REQUIRED" } });
    expect(
      dbModule
        .getDb()
        .prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=?")
        .get(run.id),
    ).toEqual({ count: 0 });
  });

  it("only treats a local scan batch as a remaining-action source", () => {
    expect(
      aiOverlayComponent.isRunAiBatchSource(
        { id: "batch", run_id: "run", page_id: null, study_freeze_id: null },
        "run",
        "batch",
      ),
    ).toBe(true);
    expect(
      aiOverlayComponent.isRunAiBatchSource(
        { id: "batch", run_id: "run", page_id: null, study_freeze_id: null },
        "run",
        "stale",
      ),
    ).toBe(false);
    expect(
      aiOverlayComponent.isRunAiBatchSource(
        { id: "batch", run_id: "other", page_id: null, study_freeze_id: null },
        "run",
        "batch",
      ),
    ).toBe(false);
    expect(
      aiOverlayComponent.isRunAiBatchSource(
        { id: "batch", run_id: "run", page_id: "page", study_freeze_id: null },
        "run",
        "batch",
      ),
    ).toBe(false);
    expect(aiOverlayComponent.isRunAiBatchSource(null, "run", null)).toBe(false);
  });

  it("uses the latest batch as remaining source after switching back to an older provider", async () => {
    const { run } = fixture(1);
    const firstProvider = provider("model-a");
    const first = ai.createAiBatch({ runId: run.id, providerConfigId: firstProvider.id });
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_batches SET status='completed' WHERE id=?")
      .run(first.batch.id);
    const secondProvider = provider("model-b");
    const second = ai.createAiBatch({ runId: run.id, providerConfigId: secondProvider.id });
    dbModule
      .getDb()
      .prepare(
        "UPDATE ai_review_batches SET status='paused',created_at='2099-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(second.batch.id);

    const summary = ai.summarizeAiRun(run.id, firstProvider.id);
    expect(summary.batch?.id).toBe(second.batch.id);
    expect(summary.latestBatchId).toBe(second.batch.id);
    expect(
      aiOverlayComponent.isRunAiBatchSource(summary.batch, run.id, summary.latestBatchId),
    ).toBe(true);

    const continuedResponse = await postReview(run.id, firstProvider.id, {
      mode: "remaining",
      requestId: crypto.randomUUID(),
      sourceBatchId: summary.batch!.id,
    });
    expect(continuedResponse.status).toBe(201);
    const continued = await continuedResponse.json();
    expect(continued.batch.source_batch_id).toBe(second.batch.id);
    expect(continued.stats.total).toBe(1);
    ai.pauseAiBatch(continued.batch.id);
  });

  it("rejects a source batch owned by another scan", async () => {
    const firstRun = fixture(1).run;
    const secondRun = fixture(1).run;
    const configured = provider();
    const sourceResponse = await postReview(firstRun.id, configured.id);
    const source = (await sourceResponse.json()).batch;
    const response = await postReview(secondRun.id, configured.id, {
      mode: "remaining",
      requestId: crypto.randomUUID(),
      sourceBatchId: source.id,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("AI_BATCH_SOURCE_INVALID");
    ai.pauseAiBatch(source.id);
  });

  it("rejects a stale remaining source when concurrent successor actions race", async () => {
    const { run } = fixture(2);
    const configured = provider();
    const originalResponse = await postReview(run.id, configured.id);
    const original = (await originalResponse.json()).batch;
    ai.pauseAiBatch(original.id);

    const responses = await Promise.all([
      postReview(run.id, configured.id, {
        mode: "remaining",
        requestId: crypto.randomUUID(),
        sourceBatchId: original.id,
      }),
      postReview(run.id, configured.id, {
        mode: "remaining",
        requestId: crypto.randomUUID(),
        sourceBatchId: original.id,
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const rejected = await responses.find((response) => response.status === 409)!.json();
    expect(rejected.error.code).toBe("AI_BATCH_SOURCE_STALE");
    const accepted = await responses.find((response) => response.status === 201)!.json();
    ai.pauseAiBatch(accepted.batch.id);
  });

  it("replays an empty-range request unchanged after manual verdicts change", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const node = dbModule
      .getDb()
      .prepare(
        `SELECT n.id FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id
       WHERE rr.run_id=? AND rr.result_type='incomplete'`,
      )
      .get(run.id) as { id: string };
    const sourceResponse = await postReview(run.id, configured.id, { mode: "all" });
    const source = (await sourceResponse.json()).batch;
    dbModule
      .getDb()
      .prepare(
        "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,NULL,'ad_hoc','local','not_problem','final',1,1,?)",
      )
      .run(`manual_${crypto.randomUUID()}`, node.id, new Date().toISOString());
    const requestId = crypto.randomUUID();
    const firstResponse = await postReview(run.id, configured.id, {
      mode: "remaining",
      sourceBatchId: source.id,
      requestId,
    });
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first).toMatchObject({ empty: true, scopeCount: 0 });
    expect(
      dbModule
        .getDb()
        .prepare(
          "SELECT status,exclusion_reason FROM ai_review_items WHERE batch_id=? AND result_node_id=?",
        )
        .get(source.id, node.id),
    ).toEqual({ status: "queued", exclusion_reason: "human_final" });
    expect(
      dbModule.getDb().prepare("SELECT status FROM ai_review_batches WHERE id=?").get(source.id),
    ).toEqual({ status: "cancelled" });

    dbModule
      .getDb()
      .prepare("UPDATE manual_reviews SET is_current=0 WHERE result_node_id=?")
      .run(node.id);
    dbModule
      .getDb()
      .prepare(
        "UPDATE ai_review_items SET exclusion_reason=NULL WHERE batch_id=? AND result_node_id=?",
      )
      .run(source.id, node.id);
    const replayResponse = await postReview(run.id, configured.id, {
      mode: "remaining",
      sourceBatchId: source.id,
      requestId,
    });
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual(first);
    expect(
      dbModule
        .getDb()
        .prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=?")
        .get(run.id),
    ).toEqual({ count: 1 });
    expect(
      dbModule.getDb().prepare("SELECT status FROM ai_review_batches WHERE id=?").get(source.id),
    ).toEqual({ status: "cancelled" });
  });

  it("reports the exact non-manual all-candidate count", () => {
    const { run } = fixture(3);
    const node = dbModule
      .getDb()
      .prepare(
        `SELECT n.id FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id
       WHERE rr.run_id=? AND rr.result_type='incomplete' ORDER BY n.id LIMIT 1`,
      )
      .get(run.id) as { id: string };
    dbModule
      .getDb()
      .prepare(
        "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,NULL,'ad_hoc','local','uncertain','final',1,1,?)",
      )
      .run(`manual_${crypto.randomUUID()}`, node.id, new Date().toISOString());
    expect(ai.summarizeAiRun(run.id)).toMatchObject({
      totalIncomplete: 3,
      aiCandidateCount: 2,
      manualResolved: 1,
    });
  });

  it("builds remaining from unfinished items and all from the full non-manual scope", async () => {
    const { run } = fixture(4);
    const oldProvider = provider("model-a");
    const currentProvider = provider("model-b");
    const started = await postReview(run.id, oldProvider.id);
    const oldBatch = (await started.json()).batch;
    const db = dbModule.getDb();
    const oldItems = db
      .prepare("SELECT id,result_node_id FROM ai_review_items WHERE batch_id=? ORDER BY id")
      .all(oldBatch.id) as Array<{ id: string; result_node_id: string }>;
    db.prepare(
      "UPDATE ai_review_items SET status='completed',verdict='problem',completed_at=? WHERE id=?",
    ).run(new Date().toISOString(), oldItems[0].id);
    db.prepare(
      "UPDATE ai_review_items SET status='failed',last_error='AI_TEST_FAILURE' WHERE id=?",
    ).run(oldItems[1].id);

    const manualNode = oldItems[3].result_node_id;
    db.prepare(
      "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,NULL,'ad_hoc','local','not_problem','manual final',1,1,?)",
    ).run(`manual_${crypto.randomUUID()}`, manualNode, new Date().toISOString());

    const continuedResponse = await postReview(run.id, currentProvider.id, {
      mode: "remaining",
      sourceBatchId: oldBatch.id,
    });
    expect(continuedResponse.status).toBe(201);
    const continued = await continuedResponse.json();
    expect(continued.stats.total).toBe(2);
    expect(
      db
        .prepare(
          "SELECT result_node_id FROM ai_review_items WHERE batch_id=? ORDER BY result_node_id",
        )
        .all(continued.batch.id),
    ).toEqual(
      oldItems
        .slice(1, 3)
        .map(({ result_node_id }) => ({ result_node_id }))
        .sort((a, b) => a.result_node_id.localeCompare(b.result_node_id)),
    );

    const allResponse = await postReview(run.id, currentProvider.id, {
      mode: "all",
      sourceBatchId: continued.batch.id,
    });
    expect(allResponse.status).toBe(201);
    const all = await allResponse.json();
    expect(all.batch.id).not.toBe(continued.batch.id);
    expect(all.stats.total).toBe(3);
    expect(
      db
        .prepare("SELECT result_node_id FROM ai_review_items WHERE batch_id=? AND result_node_id=?")
        .get(all.batch.id, oldItems[0].result_node_id),
    ).toBeTruthy();
    expect(
      db
        .prepare("SELECT status,last_error,verdict FROM ai_review_items WHERE id=?")
        .get(oldItems[1].id),
    ).toMatchObject({ status: "failed", last_error: "AI_TEST_FAILURE" });
    expect(
      db.prepare("SELECT COUNT(*) count FROM ai_review_items WHERE batch_id=?").get(oldBatch.id),
    ).toEqual({ count: 4 });
    expect(db.prepare("SELECT status FROM ai_review_batches WHERE id=?").get(oldBatch.id)).toEqual({
      status: "cancelled",
    });
    ai.pauseAiBatch(all.batch.id);
  });

  it("returns an explicit empty remaining scope without creating a zero-item batch", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const requestId = crypto.randomUUID();
    const started = await postReview(run.id, configured.id, { requestId });
    const source = (await started.json()).batch;
    dbModule
      .getDb()
      .prepare(
        "UPDATE ai_review_items SET status='completed',verdict='uncertain',completed_at=? WHERE batch_id=?",
      )
      .run(new Date().toISOString(), source.id);
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_batches SET status='completed' WHERE id=?")
      .run(source.id);
    const countBefore = dbModule
      .getDb()
      .prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=?")
      .get(run.id);

    const emptyResponse = await postReview(run.id, configured.id, {
      mode: "remaining",
      sourceBatchId: source.id,
    });
    expect(emptyResponse.status).toBe(200);
    expect(await emptyResponse.json()).toMatchObject({ empty: true, scopeCount: 0 });
    expect(
      dbModule
        .getDb()
        .prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=?")
        .get(run.id),
    ).toEqual(countBefore);
  });

  it.each(["material edit", "disable", "delete"] as const)(
    "%s retains the active lease until its exact attempt settles and preserves completed and manual data",
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
      const manualNodeId = db
        .prepare("SELECT result_node_id FROM ai_review_items WHERE id=?")
        .get(items[0].id) as { result_node_id: string };
      db.prepare(
        "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,NULL,'ad_hoc','local','uncertain','keep',1,1,?)",
      ).run(`manual_${crypto.randomUUID()}`, manualNodeId.result_node_id, new Date().toISOString());
      const exportId = `export_${crypto.randomUUID()}`;
      db.prepare(
        "INSERT INTO exports(id,run_id,kind,path,manifest_hash,created_at,status) VALUES (?,?,'json','keep.json','hash',?,'completed')",
      ).run(exportId, run.id, new Date().toISOString());

      let resolveProvider!: (response: Response) => void;
      let markProviderStarted!: () => void;
      const providerStarted = new Promise<void>((resolve) => (markProviderStarted = resolve));
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveProvider = resolve;
            markProviderStarted();
          }),
      );
      const processing = ai.processNextAiItem("w");
      await providerStarted;
      const attempt = db
        .prepare("SELECT id FROM ai_api_attempts WHERE item_id=? AND status='running'")
        .get(items[1].id) as { id: string };
      expect(
        db
          .prepare(
            "SELECT status,lease_owner,active_attempt_id,batch_revision FROM ai_review_items WHERE id=?",
          )
          .get(items[1].id),
      ).toEqual({
        status: "running",
        lease_owner: "w",
        active_attempt_id: attempt.id,
        batch_revision: 0,
      });

      if (change === "material edit") {
        const response = await providerRoute.PATCH(
          new Request(`http://localhost/api/ai/providers/${configured.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "model-b",
              label: configured.label,
              baseUrl: configured.baseUrl,
            }),
          }),
          { params: Promise.resolve({ providerId: configured.id }) },
        );
        expect(response.status, await response.clone().text()).toBe(200);
      } else if (change === "disable") {
        const response = await providerRoute.PATCH(
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
        expect(response.status, await response.clone().text()).toBe(200);
      } else {
        const response = await providerRoute.DELETE(
          new Request(`http://localhost/api/ai/providers/${configured.id}`, { method: "DELETE" }),
          { params: Promise.resolve({ providerId: configured.id }) },
        );
        expect(response.status, await response.clone().text()).toBe(200);
      }

      expect(
        db
          .prepare("SELECT status,lease_owner,active_attempt_id FROM ai_review_items WHERE id=?")
          .get(items[1].id),
      ).toEqual({
        status: "running",
        lease_owner: "w",
        active_attempt_id: attempt.id,
      });
      expect(
        db.prepare("SELECT status,cancelled_at FROM ai_api_attempts WHERE id=?").get(attempt.id),
      ).toMatchObject({
        status: "running",
        cancelled_at: expect.any(String),
      });
      resolveProvider(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"verdict":"problem","reason":"late response"}' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await expect(processing).resolves.toBe(true);

      expect(
        db.prepare("SELECT status,verdict FROM ai_review_items WHERE id=?").get(items[0].id),
      ).toEqual({
        status: "completed",
        verdict: "problem",
      });
      expect(
        db.prepare("SELECT status,last_error FROM ai_review_items WHERE id=?").get(items[1].id),
      ).toEqual({
        status: "failed",
        last_error: "AI_PROVIDER_CHANGED",
      });
      expect(
        db
          .prepare(
            "SELECT status,cancel_requested_at,revision,stop_reason,stop_requested_at FROM ai_review_batches WHERE id=?",
          )
          .get(created.batch.id),
      ).toMatchObject({
        status: "cancelled",
        cancel_requested_at: expect.any(String),
        revision: 1,
        stop_reason: "provider_changed",
        stop_requested_at: expect.any(String),
      });
      expect(
        db.prepare("SELECT cancelled_at FROM ai_api_attempts WHERE item_id=?").get(items[1].id),
      ).toMatchObject({
        cancelled_at: expect.any(String),
      });
      expect(
        db.prepare("SELECT COUNT(*) count FROM ai_api_attempts WHERE item_id=?").get(items[1].id),
      ).toEqual({ count: 1 });
      expect(
        db
          .prepare("SELECT status,error_code,cancelled_at FROM ai_api_attempts WHERE id=?")
          .get(attempt.id),
      ).toMatchObject({
        status: "cancelled",
        error_code: "AI_ATTEMPT_CANCELLED",
        cancelled_at: expect.any(String),
      });
      expect(
        db
          .prepare("SELECT note,is_current FROM manual_reviews WHERE result_node_id=?")
          .get(manualNodeId.result_node_id),
      ).toEqual({ note: "keep", is_current: 1 });
      expect(db.prepare("SELECT id FROM exports WHERE id=?").get(exportId)).toBeDefined();
      fetchSpy.mockRestore();
    },
  );

  it("does not duplicate or reset work when provider edits leave its snapshot unchanged", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const requestId = crypto.randomUUID();
    const started = await postReview(run.id, configured.id, { requestId });
    const batchId = (await started.json()).batch.id as string;
    const db = dbModule.getDb();
    db.prepare("UPDATE ai_review_items SET attempt_count=2,retry_cycle=1 WHERE batch_id=?").run(
      batchId,
    );

    const edited = await providerRoute.PATCH(
      new Request(`http://localhost/api/ai/providers/${configured.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Lifecycle provider",
          baseUrl: configured.baseUrl,
          model: configured.model,
        }),
      }),
      { params: Promise.resolve({ providerId: configured.id }) },
    );
    expect(edited.status).toBe(200);
    const repeated = await postReview(run.id, configured.id, { requestId });
    expect(repeated.status).toBe(201);
    expect((await repeated.json()).batch.id).toBe(batchId);
    expect(
      db.prepare("SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=?").get(run.id),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare("SELECT attempt_count,retry_cycle FROM ai_review_items WHERE batch_id=?")
        .get(batchId),
    ).toEqual({ attempt_count: 2, retry_cycle: 1 });
    ai.pauseAiBatch(batchId);
  });

  it("does not cancel work when a different provider is edited and keeps the response redacted", async () => {
    const { run } = fixture(1);
    const activeProvider = provider("model-active");
    const unrelatedProvider = provider("model-unrelated");
    const started = await postReview(run.id, activeProvider.id);
    const batchId = (await started.json()).batch.id as string;

    const response = await providerRoute.PATCH(
      new Request(`http://localhost/api/ai/providers/${unrelatedProvider.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: unrelatedProvider.label,
          baseUrl: unrelatedProvider.baseUrl,
          model: "model-unrelated-edited",
        }),
      }),
      { params: Promise.resolve({ providerId: unrelatedProvider.id }) },
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toContain("local-test-key");
    expect(
      dbModule
        .getDb()
        .prepare("SELECT status,revision,stop_reason FROM ai_review_batches WHERE id=?")
        .get(batchId),
    ).toEqual({
      status: "queued",
      revision: 0,
      stop_reason: null,
    });
  });

  it("cancels a provider response racing invalidation, preserves its audit, and never calls it again", async () => {
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE ai_review_batches SET status='cancelled' WHERE status IN ('queued','running')",
    ).run();
    const { run } = fixture(1);
    const configured = provider();
    const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
    let signal: AbortSignal | undefined;
    let resolveResponse!: (response: Response) => void;
    let markStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => (markStarted = resolve));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      signal = init?.signal as AbortSignal | undefined;
      markStarted();
      return new Promise<Response>((resolve) => (resolveResponse = resolve));
    });
    try {
      const processing = ai.processNextAiItem("provider-invalidation-race-worker");
      await requestStarted;
      ai.saveAiProvider({
        id: configured.id,
        label: configured.label,
        baseUrl: configured.baseUrl,
        model: "model-after-invalidation",
        apiKey: "rotated-local-key",
        enabled: true,
      });
      expect(signal?.aborted).toBe(true);
      expect(
        db
          .prepare(
            "SELECT status,lease_owner,active_attempt_id FROM ai_review_items WHERE batch_id=?",
          )
          .get(created.batch.id),
      ).toMatchObject({
        status: "running",
        lease_owner: "provider-invalidation-race-worker",
        active_attempt_id: expect.any(String),
      });
      resolveResponse(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"problem"}' } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await processing;

      const item = db
        .prepare("SELECT status,last_error,verdict FROM ai_review_items WHERE batch_id=?")
        .get(created.batch.id);
      expect(item).toEqual({ status: "failed", last_error: "AI_PROVIDER_CHANGED", verdict: null });
      expect(
        db
          .prepare("SELECT COUNT(*) count FROM ai_api_attempts WHERE batch_id=?")
          .get(created.batch.id),
      ).toEqual({ count: 1 });
      expect(
        db
          .prepare("SELECT status,cancelled_at,error_code FROM ai_api_attempts WHERE batch_id=?")
          .get(created.batch.id),
      ).toMatchObject({
        status: "cancelled",
        cancelled_at: expect.any(String),
        error_code: "AI_ATTEMPT_CANCELLED",
      });
      expect(await ai.processNextAiItem("provider-invalidation-race-worker")).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each(["success", "failure"] as const)(
    "does not strand a leased item when %s settlement races batch supersession",
    async (outcome) => {
      const db = dbModule.getDb();
      db.prepare(
        "UPDATE ai_review_batches SET status='cancelled' WHERE status IN ('queued','running')",
      ).run();
      const { run } = fixture(1);
      const configured = provider();
      const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
      const triggerName = `ai_finish_race_${crypto.randomUUID().replaceAll("-", "")}`;
      const stoppedAt = new Date().toISOString();
      db.exec(`
        CREATE TRIGGER ${triggerName} AFTER UPDATE OF status ON ai_api_attempts
        WHEN NEW.batch_id='${created.batch.id}' AND OLD.status='running'
          AND NEW.status IN ('completed','failed')
        BEGIN
          UPDATE ai_review_batches SET status='cancelled',revision=revision+1,
            stop_reason='superseded',stop_requested_at='${stoppedAt}',
            cancel_requested_at='${stoppedAt}',completed_at='${stoppedAt}',updated_at='${stoppedAt}'
          WHERE id='${created.batch.id}' AND status='running';
        END;
      `);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify(
            outcome === "success"
              ? {
                  choices: [{ message: { content: '{"verdict":"problem","reason":"smoke"}' } }],
                }
              : { error: { message: "rejected" } },
          ),
          {
            status: outcome === "success" ? 200 : 400,
            headers: { "content-type": "application/json" },
          },
        ),
      );
      try {
        await expect(ai.processNextAiItem(`finish-race-${outcome}-worker`)).resolves.toBe(true);
        expect(
          db
            .prepare("SELECT status,stop_reason FROM ai_review_batches WHERE id=?")
            .get(created.batch.id),
        ).toEqual({ status: "cancelled", stop_reason: "superseded" });
        const item = db
          .prepare(
            "SELECT status,last_error,lease_owner,lease_until,active_attempt_id FROM ai_review_items WHERE batch_id=?",
          )
          .get(created.batch.id);
        expect(item).toMatchObject({
          lease_owner: null,
          lease_until: null,
          active_attempt_id: null,
        });
        expect(item).not.toMatchObject({ status: "running" });
        expect(
          db.prepare("SELECT status FROM ai_api_attempts WHERE batch_id=?").get(created.batch.id),
        ).toEqual({ status: outcome === "success" ? "completed" : "failed" });
        const retry = await postBatchAction(created.batch.id, "retry");
        expect(retry.status).toBe(409);
        expect((await retry.json()).error.code).toBe("AI_BATCH_CANCELLED");
        await expect(ai.processNextAiItem(`finish-race-no-retry-${outcome}-worker`)).resolves.toBe(
          false,
        );
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
        fetchSpy.mockRestore();
      }
    },
  );

  it("records a worker-confirmed pre-send cancellation as not sent", async () => {
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE ai_review_batches SET status='cancelled' WHERE status IN ('queued','running')",
    ).run();
    const { run } = fixture(1);
    const configured = provider();
    const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
    const triggerName = `ai_pause_before_send_${crypto.randomUUID().replaceAll("-", "")}`;
    const stoppedAt = new Date().toISOString();
    db.exec(`
      CREATE TRIGGER ${triggerName} AFTER INSERT ON ai_api_attempts
      WHEN NEW.batch_id='${created.batch.id}'
      BEGIN
        UPDATE ai_review_batches SET status='paused',revision=revision+1,
          stop_reason='paused',stop_requested_at='${stoppedAt}',
          cancel_requested_at='${stoppedAt}',updated_at='${stoppedAt}'
        WHERE id='${created.batch.id}' AND status IN ('queued','running');
        UPDATE ai_api_attempts SET cancelled_at='${stoppedAt}'
        WHERE id=NEW.id AND status='running';
      END;
    `);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("pre-send cancellation must not invoke fetch"));
    try {
      await expect(ai.processNextAiItem("pause-before-send-worker")).resolves.toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        db
          .prepare("SELECT status,stop_reason FROM ai_review_batches WHERE id=?")
          .get(created.batch.id),
      ).toEqual({ status: "paused", stop_reason: "paused" });
      expect(
        db
          .prepare("SELECT status,send_started_at,error_code FROM ai_api_attempts WHERE batch_id=?")
          .get(created.batch.id),
      ).toEqual({ status: "cancelled", send_started_at: null, error_code: "AI_ATTEMPT_NOT_SENT" });
      expect(
        db
          .prepare(
            "SELECT status,lease_owner,active_attempt_id FROM ai_review_items WHERE batch_id=?",
          )
          .get(created.batch.id),
      ).toMatchObject({ status: "queued", lease_owner: null, active_attempt_id: null });
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
      fetchSpy.mockRestore();
    }
  });

  it.each(["late response", "hard timeout"] as const)(
    "keeps a superseded batch terminal after its old request settles by %s",
    async (settlement) => {
      const db = dbModule.getDb();
      const { run } = fixture(1);
      const configured = provider();
      const previous = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
      let resolvePrevious!: (response: Response) => void;
      let markPreviousStarted!: () => void;
      let previousSettled = false;
      let calls = 0;
      const previousStarted = new Promise<void>((resolve) => (markPreviousStarted = resolve));
      const response = () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"verdict":"uncertain","reason":"smoke"}' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        calls += 1;
        if (calls === 1)
          return new Promise<Response>((resolve) => {
            resolvePrevious = resolve;
            markPreviousStarted();
          });
        return Promise.resolve(response());
      });
      let previousProcessing: Promise<boolean> | undefined;
      try {
        previousProcessing = ai.processNextAiItem("superseded-original-worker");
        await previousStarted;

        const replacementResponse = await postReview(run.id, configured.id, {
          mode: "all",
          requestId: crypto.randomUUID(),
        });
        expect(replacementResponse.status).toBe(201);
        const replacement = await replacementResponse.json();
        expect(replacement.batch.id).not.toBe(previous.batch.id);
        expect(
          db
            .prepare("SELECT status,stop_reason FROM ai_review_batches WHERE id=?")
            .get(previous.batch.id),
        ).toEqual({ status: "cancelled", stop_reason: "superseded" });

        if (settlement === "hard timeout") {
          const expired = new Date(Date.now() - 5 * 60_000).toISOString();
          db.prepare(
            "UPDATE ai_api_attempts SET cancelled_at=?,send_started_at=? WHERE batch_id=? AND status='running'",
          ).run(expired, expired, previous.batch.id);
          // This call runs the shared expired-cancellation cleanup before it
          // claims and processes the replacement batch.
          await expect(ai.processNextAiItem("superseded-timeout-worker")).resolves.toBe(true);
        } else {
          resolvePrevious(response());
          previousSettled = true;
          await expect(previousProcessing).resolves.toBe(true);
          await expect(ai.processNextAiItem("superseded-late-worker")).resolves.toBe(true);
        }

        if (!previousSettled) {
          resolvePrevious(response());
          previousSettled = true;
          await previousProcessing;
        }

        expect(calls).toBe(2);
        expect(
          db
            .prepare("SELECT status,stop_reason FROM ai_review_batches WHERE id=?")
            .get(previous.batch.id),
        ).toEqual({ status: "cancelled", stop_reason: "superseded" });
        expect(
          db
            .prepare("SELECT status,last_error,lease_owner FROM ai_review_items WHERE batch_id=?")
            .get(previous.batch.id),
        ).toMatchObject({ status: "failed", last_error: "AI_BATCH_SUPERSEDED", lease_owner: null });
        expect(
          db
            .prepare("SELECT COUNT(*) count FROM ai_api_attempts WHERE batch_id=?")
            .get(previous.batch.id),
        ).toEqual({ count: 1 });

        const retry = await postBatchAction(previous.batch.id, "retry");
        expect(retry.status).toBe(409);
        expect((await retry.json()).error.code).toBe("AI_BATCH_CANCELLED");

        // Older cleanup could leave this same superseded batch marked failed.
        // It must remain terminal and must not become a paid retry path.
        db.prepare("UPDATE ai_review_batches SET status='failed' WHERE id=?").run(
          previous.batch.id,
        );
        const legacyRetry = await postBatchAction(previous.batch.id, "retry");
        expect(legacyRetry.status).toBe(409);
        expect((await legacyRetry.json()).error.code).toBe("AI_BATCH_CANCELLED");
        await expect(ai.processNextAiItem("superseded-no-retry-worker")).resolves.toBe(false);
        expect(calls).toBe(2);
      } finally {
        if (resolvePrevious && !previousSettled) {
          resolvePrevious(response());
          previousSettled = true;
        }
        await previousProcessing?.catch(() => undefined);
        fetchSpy.mockRestore();
      }
    },
  );

  it("keeps an expired cancelled attempt with no legacy send marker as outcome-unknown", async () => {
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE ai_review_batches SET status='paused' WHERE status IN ('queued','running','failed')",
    ).run();
    const { run } = fixture(1);
    const configured = provider();
    const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
    let resolveRequest!: (response: Response) => void;
    let markRequestStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => (markRequestStarted = resolve));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
          markRequestStarted();
        }),
    );
    let processing: Promise<boolean> | undefined;
    try {
      processing = ai.processNextAiItem("legacy-marker-worker");
      await requestStarted;
      const attempt = db
        .prepare("SELECT id FROM ai_api_attempts WHERE batch_id=? AND status='running'")
        .get(created.batch.id) as { id: string };

      ai.pauseAiBatch(created.batch.id);
      const expired = new Date(Date.now() - 5 * 60_000).toISOString();
      db.prepare("UPDATE ai_api_attempts SET send_started_at=NULL,cancelled_at=? WHERE id=?").run(
        expired,
        attempt.id,
      );
      await expect(ai.processNextAiItem("legacy-marker-cleanup-worker")).resolves.toBe(false);
      expect(
        db.prepare("SELECT status,error_code FROM ai_api_attempts WHERE id=?").get(attempt.id),
      ).toEqual({ status: "cancelled", error_code: "AI_ATTEMPT_OUTCOME_UNKNOWN" });
    } finally {
      resolveRequest?.(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"uncertain"}' } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await processing?.catch(() => undefined);
      fetchSpy.mockRestore();
    }
  });

  it.each(["success", "failure"] as const)(
    "does not let a late %s from an expired same-worker attempt overwrite the explicitly retried result",
    async (lateOutcome) => {
      const { run } = fixture(1);
      const configured = provider();
      const created = ai.createAiBatch({ runId: run.id, providerConfigId: configured.id });
      const db = dbModule.getDb();
      const itemId = (
        db.prepare("SELECT id FROM ai_review_items WHERE batch_id=?").get(created.batch.id) as {
          id: string;
        }
      ).id;
      const pendingResponses: Array<{
        resolve: (response: Response) => void;
        reject: (error: unknown) => void;
      }> = [];
      let requestNumber = 0;
      const secondRequestStarted = new Promise<void>((resolve) => {
        vi.spyOn(globalThis, "fetch").mockImplementation(() => {
          requestNumber += 1;
          if (requestNumber === 2) resolve();
          return new Promise<Response>((resolve, reject) =>
            pendingResponses.push({ resolve, reject }),
          );
        });
      });

      try {
        const oldProcessing = ai.processNextAiItem("reused-worker", 0);
        for (let wait = 0; wait < 100 && pendingResponses.length === 0; wait += 1)
          await new Promise((resolve) => setTimeout(resolve, 5));
        expect(pendingResponses).toHaveLength(1);
        const oldAttempt = db
          .prepare("SELECT id FROM ai_api_attempts WHERE item_id=? ORDER BY started_at,id LIMIT 1")
          .get(itemId) as { id: string };

        // Model a lease that elapsed while the request was still unresolved. The
        // operator explicitly opens a new attempt cycle; the worker name/slot is reused.
        db.prepare(
          "UPDATE ai_review_items SET status='failed',lease_owner=NULL,lease_until=NULL,last_error='AI_ATTEMPT_INTERRUPTED' WHERE id=?",
        ).run(itemId);
        db.prepare("UPDATE ai_review_batches SET status='failed' WHERE id=?").run(created.batch.id);
        expect(ai.retryAiBatch(created.batch.id).batch.status).toBe("queued");

        const newProcessing = ai.processNextAiItem("reused-worker", 0);
        await secondRequestStarted;
        expect(pendingResponses).toHaveLength(2);
        const newAttempt = db
          .prepare(
            "SELECT id FROM ai_api_attempts WHERE item_id=? ORDER BY started_at DESC,id DESC LIMIT 1",
          )
          .get(itemId) as { id: string };
        expect(newAttempt.id).not.toBe(oldAttempt.id);
        expect(
          db
            .prepare("SELECT active_attempt_id,batch_revision FROM ai_review_items WHERE id=?")
            .get(itemId),
        ).toEqual({
          active_attempt_id: newAttempt.id,
          batch_revision: 1,
        });
        // Simulate recovery having finalized the expired request's own audit row.
        // Its eventual network result may not rewrite that terminal audit status.
        db.prepare(
          "UPDATE ai_api_attempts SET status='failed',error_code='AI_ATTEMPT_INTERRUPTED',ended_at='expired' WHERE id=?",
        ).run(oldAttempt.id);

        const response = (verdict: "problem" | "not_problem") =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({ verdict, reason: verdict }) } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        pendingResponses[1].resolve(response("not_problem"));
        await expect(newProcessing).resolves.toBe(true);
        if (lateOutcome === "failure")
          pendingResponses[0].reject(new TypeError("late network failure"));
        else pendingResponses[0].resolve(response("problem"));
        await expect(oldProcessing).resolves.toBe(true);

        expect(
          db
            .prepare(
              "SELECT status,verdict,reason,active_attempt_id FROM ai_review_items WHERE id=?",
            )
            .get(itemId),
        ).toMatchObject({
          status: "completed",
          verdict: "not_problem",
          reason: "not_problem",
          active_attempt_id: null,
        });
        expect(
          db.prepare("SELECT status,error_code FROM ai_api_attempts WHERE id=?").get(newAttempt.id),
        ).toMatchObject({ status: "completed", error_code: null });
        expect(
          db
            .prepare("SELECT status,error_code,ended_at FROM ai_api_attempts WHERE id=?")
            .get(oldAttempt.id),
        ).toMatchObject({
          status: "failed",
          error_code: "AI_ATTEMPT_INTERRUPTED",
          ended_at: "expired",
        });
        expect(
          db
            .prepare(
              "SELECT attempt_count,retry_cycle,next_retry_at,last_error FROM ai_review_items WHERE id=?",
            )
            .get(itemId),
        ).toMatchObject({
          attempt_count: 1,
          retry_cycle: 1,
          next_retry_at: null,
          last_error: null,
        });
        expect(
          db.prepare("SELECT COUNT(*) count FROM ai_api_attempts WHERE item_id=?").get(itemId),
        ).toEqual({ count: 2 });
        expect(
          db.prepare("SELECT status FROM ai_review_batches WHERE id=?").get(created.batch.id),
        ).toEqual({ status: "completed" });
        expect(await ai.processNextAiItem("reused-worker", 0)).toBe(false);
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

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
        .prepare(
          "SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=? AND status IN ('queued','running')",
        )
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
    expect(
      db
        .prepare("SELECT status,cancel_requested_at FROM ai_review_batches WHERE id=?")
        .get(oldBatchId),
    ).toMatchObject({
      status: "cancelled",
      cancel_requested_at: expect.any(String),
    });
    expect(
      db.prepare("SELECT COUNT(*) count FROM ai_review_items WHERE batch_id=?").get(oldBatchId),
    ).toEqual({ count: 2 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM ai_review_batches WHERE run_id=? AND status IN ('queued','running')",
        )
        .get(run.id),
    ).toEqual({ count: 1 });
  });

  it("pauses, then explicitly resumes an unchanged snapshot in a new bounded attempt cycle", async () => {
    const { run } = fixture(1);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    const db = dbModule.getDb();
    db.prepare("UPDATE ai_review_items SET attempt_count=2,retry_cycle=1 WHERE batch_id=?").run(
      batchId,
    );

    const paused = await postBatchAction(batchId, "pause");
    expect(paused.status).toBe(200);
    expect((await paused.json()).batch.status).toBe("paused");
    expect(db.prepare("SELECT status FROM ai_review_items WHERE batch_id=?").get(batchId)).toEqual({
      status: "queued",
    });
    const resumed = await postBatchAction(batchId, "resume");
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).batch.status).toBe("queued");
    expect(
      db
        .prepare("SELECT attempt_count,retry_cycle FROM ai_review_items WHERE batch_id=?")
        .get(batchId),
    ).toEqual({ attempt_count: 0, retry_cycle: 2 });
  });

  it("rejects retry while paused with 409 and makes no provider call", async () => {
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_batches SET status='paused' WHERE status IN ('queued','running')")
      .run();
    const { run } = fixture(1);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    expect((await postBatchAction(batchId, "pause")).status).toBe(200);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call provider"));
    try {
      const retried = await postBatchAction(batchId, "retry");
      expect(retried.status).toBe(409);
      expect((await retried.json()).error.code).toBe("AI_BATCH_NOT_RETRYABLE");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        dbModule.getDb().prepare("SELECT status FROM ai_review_batches WHERE id=?").get(batchId),
      ).toEqual({ status: "paused" });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("aborts an in-flight request on pause and explicitly resumes it in a fresh attempt cycle", async () => {
    const { run } = fixture(1);
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE ai_review_batches SET status='paused' WHERE status IN ('queued','running','failed')",
    ).run();
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    let requestSignal: AbortSignal | undefined;
    let rejectFetch: ((reason?: unknown) => void) | undefined;
    let fetchCalls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      fetchCalls += 1;
      if (fetchCalls > 1)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"verdict":"not_problem","reason":"resumed"}' } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      return new Promise<Response>((_resolve, reject) => {
        rejectFetch = reject;
        requestSignal = init?.signal as AbortSignal;
        requestSignal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted", "AbortError")),
          { once: true },
        );
      });
    });
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
      expect(
        db
          .prepare(
            "SELECT status,attempt_count,retry_cycle,lease_owner,lease_until FROM ai_review_items WHERE batch_id=?",
          )
          .get(batchId),
      ).toMatchObject({
        status: "queued",
        attempt_count: 1,
        retry_cycle: 0,
        lease_owner: null,
        lease_until: null,
      });
      expect(
        db.prepare("SELECT status,cancelled_at FROM ai_api_attempts WHERE batch_id=?").get(batchId),
      ).toMatchObject({
        status: "cancelled",
        cancelled_at: expect.any(String),
      });

      const resumed = await postBatchAction(batchId, "resume");
      expect(resumed.status).toBe(200);
      await resumed.json();
      expect(
        db
          .prepare("SELECT attempt_count,retry_cycle FROM ai_review_items WHERE batch_id=?")
          .get(batchId),
      ).toEqual({
        attempt_count: 0,
        retry_cycle: 1,
      });
      await expect(ai.processNextAiItem("resume-after-pause-worker")).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      if (processing && requestSignal && !requestSignal.aborted)
        rejectFetch?.(new DOMException("Test cleanup", "AbortError"));
      await processing?.catch(() => undefined);
      fetchSpy.mockRestore();
    }
  });

  it.each(["success", "failure"] as const)(
    "releases the exact old lease after a cross-container pause settles with %s, then resumes immediately",
    async (settlement) => {
      const { run } = fixture(1);
      dbModule
        .getDb()
        .prepare(
          "UPDATE ai_review_batches SET status='paused' WHERE status IN ('queued','running','failed')",
        )
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
                choices: [
                  {
                    message: { content: JSON.stringify({ verdict: "uncertain", reason: "test" }) },
                  },
                ],
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
        expect(
          dbModule
            .getDb()
            .prepare("SELECT status,lease_owner,lease_until FROM ai_review_items WHERE batch_id=?")
            .get(batchId),
        ).toMatchObject({
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
        if (settlement === "failure")
          rejectFetch?.(new DOMException("The operation was aborted", "AbortError"));
        else
          resolveFetch?.(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: { content: JSON.stringify({ verdict: "uncertain", reason: "late" }) },
                  },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        await expect(processing).resolves.toBe(true);
        expect(
          dbModule
            .getDb()
            .prepare(
              "SELECT status,attempt_count,retry_cycle,lease_owner,verdict FROM ai_review_items WHERE batch_id=?",
            )
            .get(batchId),
        ).toMatchObject({
          status: "queued",
          attempt_count: 0,
          lease_owner: null,
          verdict: null,
        });
        await expect(ai.processNextAiItem("after-cancel-settled-worker")).resolves.toBe(true);
        expect(fetchCalls).toBe(2);
        expect(
          dbModule
            .getDb()
            .prepare(
              "SELECT status,attempt_count,retry_cycle,verdict FROM ai_review_items WHERE batch_id=?",
            )
            .get(batchId),
        ).toMatchObject({
          status: "completed",
          attempt_count: 1,
          retry_cycle: 1,
          verdict: "uncertain",
        });
      } finally {
        abortSpy.mockRestore();
        if (processing && requestSignal && !requestSignal.aborted) {
          ai.pauseAiBatch(batchId);
          rejectFetch?.(new DOMException("Test cleanup", "AbortError"));
        }
        await processing?.catch(() => undefined);
        fetchSpy.mockRestore();
      }
    },
  );

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
        body: JSON.stringify({
          label: configured.label,
          baseUrl: configured.baseUrl,
          model: "model-changed",
        }),
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
    dbModule
      .getDb()
      .prepare("UPDATE scan_runs SET published=1,status='completed' WHERE id=?")
      .run(run.id);
    dbModule
      .getDb()
      .prepare("UPDATE scan_jobs SET status='completed',finished_at=? WHERE id=?")
      .run(new Date().toISOString(), job.id);

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
    dbModule
      .getDb()
      .prepare("UPDATE scan_runs SET published=1,status='completed' WHERE id=?")
      .run(run.id);
    dbModule
      .getDb()
      .prepare("UPDATE scan_jobs SET status='completed',finished_at=? WHERE id=?")
      .run(new Date().toISOString(), job.id);
    const immutable = await postReview(run.id, configured.id);
    expect(immutable.status).toBe(409);
    expect((await immutable.json()).error.code).toBe("RUN_PUBLISHED_READ_ONLY");
  });

  it("reports explicit retry count and advances only unfinished item cycles", async () => {
    const { run } = fixture(3);
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    const db = dbModule.getDb();
    const rows = db
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
      .all(batchId) as Array<{ id: string }>;
    db.prepare(
      "UPDATE ai_review_items SET status='failed',attempt_count=3,retry_cycle=0,completed_at=? WHERE id=?",
    ).run(new Date().toISOString(), rows[0].id);
    db.prepare("UPDATE ai_review_items SET status='completed',verdict='problem' WHERE id=?").run(
      rows[1].id,
    );
    db.prepare("UPDATE ai_review_items SET lease_until=?,next_retry_at=? WHERE id=?").run(
      new Date(Date.now() + 60_000).toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
      rows[2].id,
    );
    db.prepare("UPDATE ai_review_batches SET status='failed' WHERE id=?").run(batchId);

    const retried = await postBatchAction(batchId, "retry");
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ retriedCount: 2, batch: { status: "queued" } });
    expect(
      db
        .prepare("SELECT status,attempt_count,retry_cycle FROM ai_review_items WHERE id=?")
        .get(rows[0].id),
    ).toEqual({ status: "queued", attempt_count: 0, retry_cycle: 1 });
    expect(
      db
        .prepare("SELECT status,attempt_count,retry_cycle,verdict FROM ai_review_items WHERE id=?")
        .get(rows[1].id),
    ).toEqual({ status: "completed", attempt_count: 0, retry_cycle: 0, verdict: "problem" });
    expect(
      db
        .prepare(
          "SELECT status,attempt_count,retry_cycle,next_retry_at FROM ai_review_items WHERE id=?",
        )
        .get(rows[2].id),
    ).toEqual({ status: "queued", attempt_count: 0, retry_cycle: 1, next_retry_at: null });
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
    expect(
      db
        .prepare("SELECT status,exclusion_reason,last_error FROM ai_review_items WHERE id=?")
        .get(item.id),
    ).toEqual({
      status: "failed",
      exclusion_reason: "human_final",
      last_error: null,
    });
  });

  it("starts a fresh bounded cycle when explicitly resuming an exhausted cycle", async () => {
    const { run } = fixture(1);
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE ai_review_batches SET status='paused' WHERE status IN ('queued','running','failed')",
    ).run();
    const configured = provider();
    const started = await postReview(run.id, configured.id);
    const batchId = (await started.json()).batch.id as string;
    db.prepare("UPDATE ai_review_items SET attempt_count=3,retry_cycle=2 WHERE batch_id=?").run(
      batchId,
    );
    expect((await postBatchAction(batchId, "pause")).status).toBe(200);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"uncertain"}' } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    try {
      const resumed = await postBatchAction(batchId, "resume");
      expect(resumed.status).toBe(200);
      expect((await resumed.json()).batch.status).toBe("queued");
      expect(
        db
          .prepare(
            "SELECT status,attempt_count,retry_cycle,last_error FROM ai_review_items WHERE batch_id=?",
          )
          .get(batchId),
      ).toEqual({
        status: "queued",
        attempt_count: 0,
        retry_cycle: 3,
        last_error: null,
      });
      await expect(ai.processNextAiItem("exhausted-cycle-worker")).resolves.toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(
        db
          .prepare("SELECT status,attempt_count,retry_cycle FROM ai_review_items WHERE batch_id=?")
          .get(batchId),
      ).toEqual({
        status: "completed",
        attempt_count: 1,
        retry_cycle: 3,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
