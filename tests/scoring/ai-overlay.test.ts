import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalize, sha256 } from "@/lib/canonical";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accessmetrics-ai-test-"));
process.env.DATABASE_URL = path.join(testRoot, "test.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");
process.env.SESSION_SECRET = "ai-overlay-test-session-secret-32";

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const ai = await import("@/lib/ai-overlay");
const runScore = await import("@/lib/run-score");

function completeEvidence(target: string) {
  const json = canonicalize({
    version: ai.AI_EVIDENCE_VERSION,
    complete: true,
    target: [target],
    facts: { tagName: "img", visible: true, matchedSelector: target },
    warnings: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
  });
  return { json, hash: sha256(json), version: ai.AI_EVIDENCE_VERSION };
}

function fixture(nodeCount = 1, withEvidence = true) {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const origin = `https://ai-${suffix}.example`;
  const site = repositories.upsertSite(origin);
  const job = repositories.createScanJob(origin, {
    maxPages: 1,
    sameOriginOnly: true,
    respectRobots: true,
  });
  const run = repositories.createRun({ id: job.id, site_id: site.id });
  const pageId = `page_ai_${suffix}`;
  dbModule
    .getDb()
    .prepare("INSERT INTO pages(id,site_id,canonical_url,first_seen_at) VALUES (?,?,?,?)")
    .run(pageId, site.id, `${origin}/`, new Date().toISOString());
  repositories.savePageResult(run.id, pageId, {
    url: `${origin}/`,
    finalUrl: `${origin}/`,
    title: "AI fixture",
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
            html: `<img data-ai="${index}">`,
            target: [`img[data-ai="${index}"]`],
            any: [],
            all: [],
            none: [],
            ...(withEvidence ? { aiEvidence: completeEvidence(`img[data-ai="${index}"]`) } : {}),
          })),
        },
      ],
      inapplicable: [],
    },
  });
  return { run, pageId, site };
}

function provider(baseUrl = "http://127.0.0.1:1234/v1") {
  return ai.saveAiProvider({
    label: "测试 Qwen",
    baseUrl,
    model: "qwen3.8-27b",
    apiKey: "test-key",
    enabled: true,
  });
}

describe("thin AI overlay", () => {
  beforeAll(() => dbModule.migrate());
  afterAll(() => dbModule.closeDb());

  it("adds only the evidence columns and three AI tables", () => {
    const tables = (
      dbModule
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(tables.sort()).toEqual(["ai_provider_configs", "ai_review_batches", "ai_review_items"]);
    const columns = (
      dbModule.getDb().prepare("PRAGMA table_info(result_nodes)").all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(columns).toEqual(
      expect.arrayContaining(["ai_evidence_json", "ai_evidence_hash", "ai_evidence_version"]),
    );
  });

  it("requires a rescan when an old incomplete node has no evidence", () => {
    const item = fixture(1, false);
    const config = provider();
    expect(() =>
      ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id }),
    ).toThrowError(expect.objectContaining({ code: "RESCAN_REQUIRED" }));
  });

  it("creates an idempotent batch and dynamically maps all three verdicts", () => {
    const item = fixture(3, true);
    const config = provider();
    const first = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const second = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    expect(second.batch.id).toBe(first.batch.id);
    expect(first.batch.run_id).toBe(item.run.id);
    expect(first.batch.page_id).toBeNull();
    expect(first.batch.provider_snapshot_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.batch.prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    const rows = dbModule
      .getDb()
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
      .all(first.batch.id) as Array<{ id: string }>;
    expect(rows).toHaveLength(3);
    const verdicts = ["problem", "not_problem", "uncertain"] as const;
    rows.forEach((row, index) => {
      dbModule
        .getDb()
        .prepare(
          "UPDATE ai_review_items SET status='completed',verdict=?,reason=?,updated_at=?,completed_at=? WHERE id=?",
        )
        .run(
          verdicts[index],
          `reason-${index}`,
          new Date().toISOString(),
          new Date().toISOString(),
          row.id,
        );
    });
    const overlay = ai.loadAiOverlayForRun(item.run.id);
    expect([...overlay.values()].sort()).toEqual(["not_problem", "problem", "uncertain"]);
    const original = runScore.loadRunOpportunities(item.run.id);
    const withOverlay = runScore.loadRunOpportunities(item.run.id, { aiOverlay: overlay });
    expect(original).toHaveLength(0);
    expect(withOverlay).toHaveLength(2);
    expect(withOverlay.filter((opportunity) => opportunity.passed)).toHaveLength(1);
    expect(withOverlay.filter((opportunity) => !opportunity.passed)[0].impact).toBe("serious");
    const summary = ai.summarizeAiRun(item.run.id);
    expect(summary.totalIncomplete).toBe(3);
    expect(summary.batch?.stats).toMatchObject({
      problem: 1,
      notProblem: 1,
      uncertain: 1,
      failed: 0,
      processedCoverage: 100,
      resolutionCoverage: 66.7,
    });
  });

  it("defines both coverages as 100% for an empty incomplete population", () => {
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const origin = `https://ai-empty-${suffix}.example`;
    const site = repositories.upsertSite(origin);
    const job = repositories.createScanJob(origin, {
      maxPages: 1,
      sameOriginOnly: true,
      respectRobots: true,
    });
    const run = repositories.createRun({ id: job.id, site_id: site.id });
    const config = provider();
    const batch = ai.createAiBatch({ runId: run.id, providerConfigId: config.id });
    expect(batch.batch.status).toBe("completed");
    expect(batch.stats.processedCoverage).toBe(100);
    expect(batch.stats.resolutionCoverage).toBe(100);
  });

  it("creates one formal batch per study freeze with null run and page scope", () => {
    const item = fixture(1, true);
    const config = provider();
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const campaignId = `campaign_ai_${suffix}`;
    const freezeId = `freeze_ai_${suffix}`;
    const timestamp = new Date().toISOString();
    const db = dbModule.getDb();
    db.prepare(
      "INSERT INTO study_campaigns(id,campaign_plan_hash,protocol_hash,sample_frame_hash,baseline_triple_json,target_site_count,page_limit,retry_policy_json,replacement_policy_json,allowed_failure_reason_codes_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      campaignId,
      sha256(campaignId),
      sha256("protocol"),
      sha256("frame"),
      "{}",
      10,
      1,
      "{}",
      "{}",
      "[]",
      "planned",
      timestamp,
    );
    db.prepare(
      "INSERT INTO study_run_attempts(id,campaign_id,slot,candidate_id,replacement_rank,attempt_no,run_id,trigger,terminal_status,usability_decision,decision_reason_code,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      `attempt_ai_${suffix}`,
      campaignId,
      1,
      `candidate_ai_${suffix}`,
      0,
      1,
      item.run.id,
      "test",
      "completed",
      "included",
      null,
      timestamp,
      timestamp,
    );
    db.prepare(
      "INSERT INTO study_freezes(id,campaign_id,attempt_log_hash,freeze_digest,protocol_hash,sample_frame_hash,execution_log_hash,scanner_version,axe_version,model_version,run_set_hash,population_digest,eligible_population_count,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      freezeId,
      campaignId,
      sha256("attempts"),
      sha256("freeze"),
      sha256("protocol"),
      sha256("frame"),
      sha256("execution"),
      "scanner",
      "4.13.0",
      "accesscheck-score-v1",
      sha256(item.run.id),
      sha256("population"),
      1,
      "registered",
      timestamp,
    );
    const first = ai.createAiBatch({ studyFreezeId: freezeId, providerConfigId: config.id });
    const second = ai.createAiBatch({ studyFreezeId: freezeId, providerConfigId: config.id });
    expect(second.batch.id).toBe(first.batch.id);
    expect(first.batch.run_id).toBeNull();
    expect(first.batch.page_id).toBeNull();
    expect(first.batch.study_freeze_id).toBe(freezeId);
    expect(first.batch.batch_key).toBe(`ai-formal:${freezeId}`);
    db.prepare(
      "UPDATE ai_review_items SET status='completed',verdict='uncertain',completed_at=?,updated_at=? WHERE batch_id=?",
    ).run(timestamp, timestamp, first.batch.id);
    db.prepare(
      "UPDATE ai_review_batches SET status='completed',completed_at=?,updated_at=? WHERE id=?",
    ).run(timestamp, timestamp, first.batch.id);
  });

  it("enforces provider URL policy and redirects are not followed", () => {
    expect(ai.validateAiProviderUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1");
    expect(ai.validateAiProviderUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1");
    expect(() => ai.validateAiProviderUrl("http://model.example/v1")).toThrowError(
      expect.objectContaining({ code: "AI_PROVIDER_URL_TLS_REQUIRED" }),
    );
    expect(() => ai.validateAiProviderUrl("https://user:pass@model.example/v1")).toThrowError(
      expect.objectContaining({ code: "AI_PROVIDER_URL_CREDENTIALS" }),
    );
  });

  it("processes one item through a fake OpenAI-compatible provider", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '{"verdict":"problem","reason":"fixture"}' } }],
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const item = fixture(1, true);
      const config = provider(`http://127.0.0.1:${port}/v1`);
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
      expect(await ai.processNextAiItem("test-worker")).toBe(true);
      const row = dbModule
        .getDb()
        .prepare(
          "SELECT status,verdict,reason,attempt_count,response_hash,lease_owner,last_error FROM ai_review_items WHERE batch_id=?",
        )
        .get(batch.batch.id) as any;
      expect(row).toMatchObject({
        status: "completed",
        verdict: "problem",
        reason: "fixture",
        attempt_count: 1,
        lease_owner: null,
      });
      expect(row.response_hash).toMatch(/^[a-f0-9]{64}$/);
      expect((ai.getAiBatch(batch.batch.id) as any).batch.status).toBe("completed");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("resets failed item attempts when the batch is retried", () => {
    const item = fixture(1, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const timestamp = new Date().toISOString();
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE ai_review_items SET status='failed',attempt_count=3,last_error='temporary',completed_at=?,updated_at=? WHERE batch_id=?",
    ).run(timestamp, timestamp, batch.batch.id);
    db.prepare("UPDATE ai_review_batches SET status='failed',updated_at=? WHERE id=?").run(
      timestamp,
      batch.batch.id,
    );
    ai.retryAiBatch(batch.batch.id);
    const row = db
      .prepare(
        "SELECT status,attempt_count,last_error,response_hash FROM ai_review_items WHERE batch_id=?",
      )
      .get(batch.batch.id) as any;
    expect(row).toEqual({
      status: "queued",
      attempt_count: 0,
      last_error: null,
      response_hash: null,
    });
  });

  it("keeps duplicate item protection at the database boundary", () => {
    const item = fixture(1, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const row = dbModule
      .getDb()
      .prepare("SELECT result_node_id FROM ai_review_items WHERE batch_id=?")
      .get(batch.batch.id) as { result_node_id: string };
    expect(() =>
      dbModule
        .getDb()
        .prepare(
          "INSERT INTO ai_review_items(id,batch_id,result_node_id,status,attempt_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          "duplicate-ai-item",
          batch.batch.id,
          row.result_node_id,
          "queued",
          0,
          new Date().toISOString(),
          new Date().toISOString(),
        ),
    ).toThrow();
  });
});
