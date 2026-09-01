import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const resolution = await import("@/lib/incomplete-resolution");
const report = await import("@/lib/report");
const reportJsonRoute = await import("@/app/api/reports/[runId]/json/route");
const incompleteReviewRoute =
  await import("@/app/api/runs/[runId]/incomplete/[nodeId]/review/route");

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

function fixture(nodeCount = 1, withEvidence = true, withPass = false) {
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
      passes: withPass
        ? [
            {
              id: "image-alt",
              impact: null,
              tags: ["wcag111"],
              description: "Image alternative text",
              help: "Images must have alternate text",
              helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
              nodes: [{ html: '<img alt="ok">', target: ["img"], any: [], all: [], none: [] }],
            },
          ]
        : [],
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

function provider(
  baseUrl = "http://127.0.0.1:1234/v1",
  maxConcurrentRequests = 1,
  rateLimitRpm: number | null = null,
) {
  return ai.saveAiProvider({
    label: "测试 Qwen",
    baseUrl,
    model: "qwen3.8-27b",
    apiKey: "test-key",
    maxConcurrentRequests,
    rateLimitRpm,
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
    const providerColumns = (
      dbModule.getDb().prepare("PRAGMA table_info(ai_provider_configs)").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(providerColumns).toEqual(
      expect.arrayContaining(["max_concurrent_requests", "rate_limit_rpm"]),
    );
  });

  it("keeps old incomplete nodes eligible when evidence was not captured", () => {
    const item = fixture(1, false);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    expect(batch.batch.evidence_version).toBe(ai.AI_EVIDENCE_VERSION);
    expect(batch.stats).toMatchObject({ total: 1, queued: 1, completed: 0 });
    const row = dbModule
      .getDb()
      .prepare("SELECT evidence_hash FROM ai_review_items WHERE batch_id=?")
      .get(batch.batch.id) as { evidence_hash: string | null };
    expect(row.evidence_hash).toBeNull();
    // Leave the worker queue isolated for the fake provider test below.
    ai.pauseAiBatch(batch.batch.id);
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
    expect(first.batch.provider_snapshot_json).not.toContain("test-key");
    const storedRaw = dbModule
      .getDb()
      .prepare("SELECT raw_json FROM rule_results WHERE run_id=? AND result_type='incomplete'")
      .get(item.run.id) as { raw_json: string };
    expect(storedRaw.raw_json).not.toContain("aiEvidence");
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
    dbModule
      .getDb()
      .prepare(
        "UPDATE ai_review_batches SET status='completed',completed_at=?,updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), new Date().toISOString(), first.batch.id);
  });

  it("keeps the raw incomplete count while AI verdicts change the effective score", () => {
    const item = fixture(1, true, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const node = dbModule
      .getDb()
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=?")
      .get(batch.batch.id) as { id: string };
    const timestamp = new Date().toISOString();
    dbModule
      .getDb()
      .prepare(
        "UPDATE ai_review_items SET status='completed',verdict='problem',completed_at=?,updated_at=? WHERE id=?",
      )
      .run(timestamp, timestamp, node.id);
    dbModule
      .getDb()
      .prepare(
        "UPDATE ai_review_batches SET status='completed',completed_at=?,updated_at=? WHERE id=?",
      )
      .run(timestamp, timestamp, batch.batch.id);

    const raw = runScore.buildRunScore(item.run.id);
    const effective = runScore.buildRunScore(item.run.id, {
      aiOverlay: ai.loadEffectiveOverlayForRun(item.run.id),
    });

    expect(raw.resultNodeCounts.incomplete).toBe(1);
    expect(effective.resultNodeCounts.incomplete).toBe(1);
    expect(raw.overall).toBe(100);
    expect(effective.overall).toBeLessThan(raw.overall!);
    expect(effective.modelVersion).toContain("ai-overlay-v1");
  });

  it("keeps an existing batch status unchanged when create is retried", () => {
    const item = fixture(1, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const db = dbModule.getDb();
    for (const status of ["queued", "running", "paused", "failed", "completed"] as const) {
      db.prepare("UPDATE ai_review_batches SET status=? WHERE id=?").run(status, batch.batch.id);
      expect(
        ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id }).batch.status,
      ).toBe(status);
    }
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

  it("scores from scan-time frozen eligibility and principles, with null violation impact as minor", () => {
    const item = fixture(1, true);
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE rule_results SET result_type='violation',impact=NULL,scoring_eligible=1,principles_json=? WHERE run_id=?",
    ).run('["operable"]', item.run.id);
    db.prepare(
      "UPDATE result_nodes SET impact=NULL,effective_impact=NULL WHERE rule_result_id IN (SELECT id FROM rule_results WHERE run_id=?)",
    ).run(item.run.id);
    expect(runScore.loadRunOpportunities(item.run.id)).toMatchObject([
      { passed: false, impact: "minor", principles: ["operable"] },
    ]);
    db.prepare("UPDATE rule_results SET scoring_eligible=0 WHERE run_id=?").run(item.run.id);
    expect(runScore.loadRunOpportunities(item.run.id)).toHaveLength(0);
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

  it("validates and exposes the provider concurrency cap", () => {
    const config = provider(undefined, 4);
    expect(config.maxConcurrentRequests).toBe(4);
    expect(() => provider(undefined, 0)).toThrowError(
      expect.objectContaining({ code: "AI_PROVIDER_CONCURRENCY_INVALID" }),
    );
  });

  it("processes one item through a fake OpenAI-compatible provider", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        response.setHeader("content-type", "application/json");
        const chunks: Buffer[] = [];
        request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        request.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            response_format?: { type?: string };
            max_tokens?: number;
          };
          if (body.response_format?.type === "json_object") {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "json_object is unsupported" }));
            return;
          }
          expect(body.max_tokens).toBeUndefined();
          response.end(
            JSON.stringify({
              choices: [{ message: { content: '{"verdict":"problem","reason":"fixture"}' } }],
            }),
          );
        });
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

  it("waits and retries after a provider rate limit instead of failing the batch", async () => {
    let requests = 0;
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        requests += 1;
        response.statusCode = 429;
        response.setHeader("retry-after", "60");
        response.end(JSON.stringify({ error: "rate limited" }));
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

      expect(await ai.processNextAiItem("rate-limit-worker")).toBe(true);
      const current = ai.getAiBatch(batch.batch.id) as any;
      const row = dbModule
        .getDb()
        .prepare(
          "SELECT status,attempt_count,last_error,lease_until FROM ai_review_items WHERE batch_id=?",
        )
        .get(batch.batch.id) as any;
      expect(current.batch.status).toBe("queued");
      expect(current.stats).toMatchObject({ queued: 1, delayed: 1, failed: 0 });
      expect(row).toMatchObject({
        status: "queued",
        attempt_count: 1,
        last_error: "模型服务限流，等待后自动重试",
      });
      expect(new Date(row.lease_until).getTime()).toBeGreaterThan(Date.now());

      expect(await ai.processNextAiItem("rate-limit-worker")).toBe(false);
      expect(requests).toBe(1);
      ai.pauseAiBatch(batch.batch.id);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("uses a one-minute fallback for repeated rate limits without Retry-After", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        response.statusCode = 429;
        response.end(JSON.stringify({ error: "rate limited" }));
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

      await ai.processNextAiItem("repeated-rate-limit-worker");
      const row = dbModule
        .getDb()
        .prepare("SELECT id FROM ai_review_items WHERE batch_id=?")
        .get(batch.batch.id) as { id: string };
      dbModule
        .getDb()
        .prepare("UPDATE ai_review_items SET lease_until=? WHERE id=?")
        .run(new Date(Date.now() - 1_000).toISOString(), row.id);

      await ai.processNextAiItem("repeated-rate-limit-worker");
      const retried = dbModule
        .getDb()
        .prepare("SELECT attempt_count,lease_until FROM ai_review_items WHERE id=?")
        .get(row.id) as { attempt_count: number; lease_until: string };
      expect(retried.attempt_count).toBe(2);
      expect(new Date(retried.lease_until).getTime() - Date.now()).toBeLessThan(70_000);
      expect(new Date(retried.lease_until).getTime() - Date.now()).toBeGreaterThan(50_000);
      ai.pauseAiBatch(batch.batch.id);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("honors a provider Retry-After longer than the generic retry cap", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        response.statusCode = 429;
        response.setHeader("retry-after", "1200");
        response.end(JSON.stringify({ error: "rate limited" }));
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

      await ai.processNextAiItem("long-retry-after-worker");
      const row = dbModule
        .getDb()
        .prepare("SELECT lease_until FROM ai_review_items WHERE batch_id=?")
        .get(batch.batch.id) as { lease_until: string };
      expect(new Date(row.lease_until).getTime() - Date.now()).toBeGreaterThan(19 * 60_000);
      ai.pauseAiBatch(batch.batch.id);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("requeues an invalid model verdict immediately", async () => {
    let requests = 0;
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        requests += 1;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    requests === 1
                      ? '{"verdict":"maybe"}'
                      : '{"verdict":"problem","reason":"retried"}',
                },
              },
            ],
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

      expect(await ai.processNextAiItem("invalid-verdict-worker")).toBe(true);
      const queued = dbModule
        .getDb()
        .prepare("SELECT status,lease_until,last_error FROM ai_review_items WHERE batch_id=?")
        .get(batch.batch.id) as any;
      expect(queued).toMatchObject({
        status: "queued",
        lease_until: null,
        last_error: "模型 verdict 不在 problem/not_problem/uncertain 内",
      });

      expect(await ai.processNextAiItem("invalid-verdict-worker")).toBe(true);
      expect(requests).toBe(2);
      expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
        batch: { status: "completed" },
        stats: { completed: 1, queued: 0, delayed: 0, failed: 0 },
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("paces OpenRouter free requests at 20 RPM without changing the configured concurrency", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"verdict":"problem"}' } }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    try {
      const item = fixture(2, true);
      const config = ai.saveAiProvider({
        label: "OpenRouter free",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "poolside/laguna-s-2.1:free",
        apiKey: "openrouter-test-key",
        maxConcurrentRequests: 4,
        rateLimitRpm: 20,
        enabled: true,
      });
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });

      expect(batch.stats.providerRateLimitRpm).toBe(20);
      expect(config.maxConcurrentRequests).toBe(4);
      expect(await ai.processNextAiItem("openrouter-free-worker")).toBe(true);
      expect(await ai.processNextAiItem("openrouter-free-worker")).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
        batch: { status: "running" },
        stats: { completed: 1, queued: 1, providerRateLimitRpm: 20 },
      });
      ai.pauseAiBatch(batch.batch.id);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not apply the free-model pace to a paid OpenRouter model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"verdict":"problem"}' } }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    try {
      const item = fixture(2, true);
      const config = ai.saveAiProvider({
        label: "OpenRouter paid",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4.1-mini",
        apiKey: "openrouter-paid-test-key",
        maxConcurrentRequests: 4,
        enabled: true,
      });
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });

      expect(batch.stats.providerRateLimitRpm).toBeNull();
      expect(await ai.processNextAiItem("openrouter-paid-worker")).toBe(true);
      expect(await ai.processNextAiItem("openrouter-paid-worker")).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      ai.pauseAiBatch(batch.batch.id);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not pace an OpenRouter free model when the optional strategy is disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"problem"}' } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    try {
      const item = fixture(2, true);
      const config = ai.saveAiProvider({
        label: "OpenRouter free without pace",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "poolside/laguna-s-2.1:free",
        apiKey: "openrouter-disabled-key",
        maxConcurrentRequests: 4,
        rateLimitRpm: null,
        enabled: true,
      });
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });

      expect(batch.stats.providerRateLimitRpm).toBeNull();
      expect(await ai.processNextAiItem("openrouter-free-unpaced-worker")).toBe(true);
      expect(await ai.processNextAiItem("openrouter-free-unpaced-worker")).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
        batch: { status: "completed" },
        stats: { completed: 2, queued: 0, delayed: 0, failed: 0 },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps processing queued items after a non-retryable item exhausts its retries", async () => {
    let requests = 0;
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        requests += 1;
        response.statusCode = 400;
        response.end(JSON.stringify({ error: "invalid provider request" }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const item = fixture(2, true);
      const config = provider(`http://127.0.0.1:${port}/v1`);
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });

      await ai.processNextAiItem("terminal-error-worker");
      await ai.processNextAiItem("terminal-error-worker");
      await ai.processNextAiItem("terminal-error-worker");
      expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
        batch: { status: "queued" },
        stats: { queued: 1, failed: 1 },
      });

      expect(await ai.processNextAiItem("terminal-error-worker")).toBe(true);
      expect(requests).toBe(4);
      ai.pauseAiBatch(batch.batch.id);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("queues temporary provider failures for automatic retry", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "service unavailable" }));
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

      expect(await ai.processNextAiItem("temporary-error-worker")).toBe(true);
      expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
        batch: { status: "queued" },
        stats: { queued: 1, delayed: 0, failed: 0 },
      });
      const row = dbModule
        .getDb()
        .prepare("SELECT lease_until FROM ai_review_items WHERE batch_id=?")
        .get(batch.batch.id) as { lease_until: string | null };
      expect(row.lease_until).toBeNull();
      ai.pauseAiBatch(batch.batch.id);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("requeues a network fetch failure immediately", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{\"verdict\":\"problem\"}' } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    try {
      const item = fixture(1, true);
      const config = provider();
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });

      expect(await ai.processNextAiItem("network-error-worker")).toBe(true);
      expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
        batch: { status: "queued" },
        stats: { queued: 1, delayed: 0, failed: 0 },
      });
      const queued = dbModule
        .getDb()
        .prepare("SELECT status,lease_until,last_error FROM ai_review_items WHERE batch_id=?")
        .get(batch.batch.id) as any;
      expect(queued).toEqual({
        status: "queued",
        lease_until: null,
        last_error: "TypeError: fetch failed",
      });

      expect(await ai.processNextAiItem("network-error-worker")).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
        batch: { status: "completed" },
        stats: { completed: 1, queued: 0, delayed: 0, failed: 0 },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("automatically recovers a legacy failed batch that still has queued work", async () => {
    const item = fixture(2, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const db = dbModule.getDb();
    const first = db
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id LIMIT 1")
      .get(batch.batch.id) as { id: string };
    const timestamp = new Date().toISOString();
    db.prepare(
      "UPDATE ai_review_items SET status='failed',attempt_count=3,last_error='模型请求失败（HTTP 429）',completed_at=?,updated_at=? WHERE id=?",
    ).run(timestamp, timestamp, first.id);
    db.prepare(
      "UPDATE ai_review_batches SET status='failed',completed_at=?,updated_at=? WHERE id=?",
    ).run(timestamp, timestamp, batch.batch.id);

    expect(await ai.processNextAiItem("legacy-recovery-worker")).toBe(false);
    expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
      batch: { status: "queued" },
      stats: { queued: 2, delayed: 1, failed: 0 },
    });
    ai.pauseAiBatch(batch.batch.id);
  });

  it("automatically requeues a retryable failed item while its batch is still active", async () => {
    const item = fixture(2, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const db = dbModule.getDb();
    const rows = db
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
      .all(batch.batch.id) as Array<{ id: string }>;
    const timestamp = new Date().toISOString();
    db.prepare(
      "UPDATE ai_review_items SET status='failed',attempt_count=3,last_error='模型返回内容为空',completed_at=?,updated_at=? WHERE id=?",
    ).run(timestamp, timestamp, rows[0].id);
    db.prepare("UPDATE ai_review_items SET lease_until=? WHERE id=?").run(
      new Date(Date.now() + 60_000).toISOString(),
      rows[1].id,
    );
    db.prepare("UPDATE ai_review_batches SET status='running',updated_at=? WHERE id=?").run(
      timestamp,
      batch.batch.id,
    );

    expect(await ai.processNextAiItem("active-recovery-worker")).toBe(false);
    const recovered = db
      .prepare("SELECT status,attempt_count,last_error,lease_until FROM ai_review_items WHERE id=?")
      .get(rows[0].id) as any;
    expect(recovered).toMatchObject({
      status: "queued",
      attempt_count: 0,
      last_error: "历史可重试失败已重新排队，等待后自动重试",
    });
    expect(new Date(recovered.lease_until).getTime()).toBeGreaterThan(Date.now());
    expect(ai.getAiBatch(batch.batch.id)).toMatchObject({ stats: { queued: 2, failed: 0 } });
    ai.pauseAiBatch(batch.batch.id);
  });

  it("automatically resumes queued work from a legacy failed batch", async () => {
    const item = fixture(2, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const db = dbModule.getDb();
    const rows = db
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
      .all(batch.batch.id) as Array<{ id: string }>;
    const timestamp = new Date().toISOString();
    db.prepare(
      "UPDATE ai_review_items SET status='failed',attempt_count=3,last_error='模型请求失败（HTTP 400）',completed_at=?,updated_at=? WHERE id=?",
    ).run(timestamp, timestamp, rows[0].id);
    db.prepare("UPDATE ai_review_items SET lease_until=? WHERE id=?").run(
      new Date(Date.now() + 60_000).toISOString(),
      rows[1].id,
    );
    db.prepare("UPDATE ai_review_batches SET status='failed',updated_at=? WHERE id=?").run(
      timestamp,
      batch.batch.id,
    );

    expect(await ai.processNextAiItem("legacy-queued-worker")).toBe(false);
    expect(ai.getAiBatch(batch.batch.id)).toMatchObject({
      batch: { status: "queued" },
      stats: { queued: 1, failed: 1 },
    });
    ai.pauseAiBatch(batch.batch.id);
  });

  it("does not revive a stale provider snapshot during legacy recovery", async () => {
    const item = fixture(2, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const db = dbModule.getDb();
    const first = db
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id LIMIT 1")
      .get(batch.batch.id) as { id: string };
    const timestamp = new Date().toISOString();
    db.prepare(
      "UPDATE ai_review_items SET status='failed',attempt_count=3,last_error='模型请求失败（HTTP 429）',completed_at=?,updated_at=? WHERE id=?",
    ).run(timestamp, timestamp, first.id);
    db.prepare(
      "UPDATE ai_review_batches SET status='failed',completed_at=?,updated_at=? WHERE id=?",
    ).run(timestamp, timestamp, batch.batch.id);
    ai.saveAiProvider({
      id: config.id,
      label: "测试 Qwen",
      baseUrl: "http://127.0.0.1:4321/v1",
      model: "qwen3.8-27b",
      apiKey: "changed-key",
      enabled: true,
    });

    expect(await ai.processNextAiItem("stale-recovery-worker")).toBe(false);
    expect(ai.getAiBatch(batch.batch.id)).toMatchObject({ batch: { status: "failed" } });
  });

  it("returns the batch for the selected current provider snapshot", () => {
    const item = fixture(1, true);
    const config = provider();
    const stale = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    ai.pauseAiBatch(stale.batch.id);
    const current = ai.saveAiProvider({
      id: config.id,
      label: "测试 Qwen",
      baseUrl: "http://127.0.0.1:4321/v1",
      model: "qwen3.8-27b",
      apiKey: "new-key",
      enabled: true,
    });
    const fresh = ai.createAiBatch({ runId: item.run.id, providerConfigId: current.id });

    expect(ai.summarizeAiRun(item.run.id, current.id).batch?.id).toBe(fresh.batch.id);
    ai.pauseAiBatch(fresh.batch.id);
  });

  it("does not mark a paused batch completed when only failed items remain", () => {
    const item = fixture(1, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const timestamp = new Date().toISOString();
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE ai_review_items SET status='failed',attempt_count=3,last_error='temporary',completed_at=?,updated_at=? WHERE batch_id=?",
    ).run(timestamp, timestamp, batch.batch.id);
    db.prepare("UPDATE ai_review_batches SET status='paused',updated_at=? WHERE id=?").run(
      timestamp,
      batch.batch.id,
    );

    expect(ai.resumeAiBatch(batch.batch.id)).toMatchObject({ batch: { status: "failed" } });
  });

  it("does not claim page-scoped batches", async () => {
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"problem"}' } }] }),
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
      const legacy = fixture(1, true);
      const config = provider(`http://127.0.0.1:${port}/v1`);
      const legacyBatch = ai.createAiBatch({ runId: legacy.run.id, providerConfigId: config.id });
      dbModule
        .getDb()
        .prepare("UPDATE ai_review_batches SET page_id=?,created_at=? WHERE id=?")
        .run(legacy.pageId, "2000-01-01T00:00:00.000Z", legacyBatch.batch.id);
      const runWide = fixture(1, true);
      const runWideBatch = ai.createAiBatch({ runId: runWide.run.id, providerConfigId: config.id });
      expect(await ai.processNextAiItem("scope-worker")).toBe(true);
      expect(
        (
          dbModule
            .getDb()
            .prepare("SELECT status FROM ai_review_items WHERE batch_id=?")
            .get(legacyBatch.batch.id) as { status: string }
        ).status,
      ).toBe("queued");
      expect(
        (
          dbModule
            .getDb()
            .prepare("SELECT status FROM ai_review_items WHERE batch_id=?")
            .get(runWideBatch.batch.id) as { status: string }
        ).status,
      ).toBe("completed");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps one in-flight request per provider by default", async () => {
    let requests = 0;
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        requests += 1;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"problem"}' } }] }),
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
      const otherItem = fixture(1, true);
      const config = provider(`http://127.0.0.1:${port}/v1`);
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
      const otherBatch = ai.createAiBatch({ runId: otherItem.run.id, providerConfigId: config.id });
      const rows = dbModule
        .getDb()
        .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
        .all(batch.batch.id) as Array<{ id: string }>;
      const leaseUntil = new Date(Date.now() + 60_000).toISOString();
      dbModule
        .getDb()
        .prepare(
          "UPDATE ai_review_items SET status='running',lease_owner='other-worker',lease_until=?,attempt_count=1 WHERE id=?",
        )
        .run(leaseUntil, rows[0].id);
      expect(await ai.processNextAiItem("single-provider-worker")).toBe(false);
      expect(requests).toBe(0);

      dbModule
        .getDb()
        .prepare("UPDATE ai_review_items SET lease_until=? WHERE id=?")
        .run(new Date(Date.now() - 1_000).toISOString(), rows[0].id);
      expect(await ai.processNextAiItem("single-provider-worker")).toBe(true);
      expect(requests).toBe(1);
      dbModule
        .getDb()
        .prepare("UPDATE ai_review_batches SET status='paused' WHERE id=?")
        .run(batch.batch.id);
      dbModule
        .getDb()
        .prepare("UPDATE ai_review_batches SET status='paused' WHERE id=?")
        .run(otherBatch.batch.id);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("allows the configured number of concurrent requests for a provider", async () => {
    let requests = 0;
    const server = http.createServer((request, response) => {
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        requests += 1;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({ choices: [{ message: { content: '{"verdict":"problem"}' } }] }),
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
      const item = fixture(2, true);
      const config = provider(`http://127.0.0.1:${port}/v1`, 2);
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
      const rows = dbModule
        .getDb()
        .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
        .all(batch.batch.id) as Array<{ id: string }>;
      const leaseUntil = new Date(Date.now() + 60_000).toISOString();
      dbModule
        .getDb()
        .prepare(
          "UPDATE ai_review_items SET status='running',lease_owner='other-worker',lease_until=?,attempt_count=1 WHERE id=?",
        )
        .run(leaseUntil, rows[0].id);

      expect(await ai.processNextAiItem("parallel-provider-worker")).toBe(true);
      expect(requests).toBe(1);

      dbModule
        .getDb()
        .prepare("UPDATE ai_review_items SET lease_until=? WHERE id=?")
        .run(new Date(Date.now() - 1_000).toISOString(), rows[0].id);
      dbModule
        .getDb()
        .prepare("UPDATE ai_review_batches SET status='paused' WHERE id=?")
        .run(batch.batch.id);
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
    db.prepare("UPDATE ai_review_batches SET status='paused' WHERE id=?").run(batch.batch.id);
  });

  it("requires retry instead of resuming a terminally failed batch", () => {
    const item = fixture(1, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_batches SET status='failed' WHERE id=?")
      .run(batch.batch.id);
    expect(() => ai.resumeAiBatch(batch.batch.id)).toThrowError(
      expect.objectContaining({ code: "AI_BATCH_RETRY_REQUIRED" }),
    );
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
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_batches SET status='paused' WHERE id=?")
      .run(batch.batch.id);
  });

  it("always gives a local ad_hoc verdict precedence over AI", () => {
    const item = fixture(1, true);
    const nodeId = (
      dbModule
        .getDb()
        .prepare(
          "SELECT n.id FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id WHERE rr.run_id=?",
        )
        .get(item.run.id) as { id: string }
    ).id;
    resolution.saveLocalManualVerdict({
      runId: item.run.id,
      resultNodeId: nodeId,
      verdict: "not_problem",
    });
    expect(
      resolution
        .applyHumanPrecedence(
          new Map([[nodeId, "problem" as const]]),
          resolution.loadLocalManualVerdicts(item.run.id),
        )
        .get(nodeId),
    ).toBe("not_problem");
  });

  it("clears a local verdict and restores the AI or raw state", async () => {
    const item = fixture(1, true);
    const nodeId = (
      dbModule
        .getDb()
        .prepare(
          "SELECT n.id FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id WHERE rr.run_id=?",
        )
        .get(item.run.id) as { id: string }
    ).id;
    const context = { params: Promise.resolve({ runId: item.run.id, nodeId }) };

    const saved = await incompleteReviewRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict: "not_problem", note: "temporary" }),
      }),
      context,
    );
    expect(saved.status).toBe(200);
    expect(
      resolution
        .applyHumanPrecedence(
          new Map([[nodeId, "problem" as const]]),
          resolution.loadLocalManualVerdicts(item.run.id),
        )
        .get(nodeId),
    ).toBe("not_problem");

    const cleared = await incompleteReviewRoute.DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      context,
    );
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ cleared: true });
    expect(resolution.loadLocalManualVerdicts(item.run.id).has(nodeId)).toBe(false);
    expect(
      resolution
        .applyHumanPrecedence(
          new Map([[nodeId, "problem" as const]]),
          resolution.loadLocalManualVerdicts(item.run.id),
        )
        .get(nodeId),
    ).toBe("problem");
    expect(
      dbModule
        .getDb()
        .prepare("SELECT is_current FROM manual_reviews WHERE result_node_id=?")
        .get(nodeId),
    ).toMatchObject({ is_current: 0 });
  });

  it("locks manual edits only while an AI batch is queued or running", () => {
    const item = fixture(1, true);
    const config = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
    const nodeId = (
      dbModule
        .getDb()
        .prepare("SELECT result_node_id FROM ai_review_items WHERE batch_id=?")
        .get(batch.batch.id) as { result_node_id: string }
    ).result_node_id;
    expect(() =>
      resolution.saveLocalManualVerdict({
        runId: item.run.id,
        resultNodeId: nodeId,
        verdict: "problem",
      }),
    ).toThrowError(expect.objectContaining({ code: "AI_REVIEW_ACTIVE" }));
    ai.pauseAiBatch(batch.batch.id);
    expect(
      resolution.saveLocalManualVerdict({
        runId: item.run.id,
        resultNodeId: nodeId,
        verdict: "problem",
      }).updated,
    ).toBe(false);
    const running = fixture(1, true);
    const runningBatch = ai.createAiBatch({ runId: running.run.id, providerConfigId: config.id });
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_batches SET status='running' WHERE id=?")
      .run(runningBatch.batch.id);
    const runningNode = (
      dbModule
        .getDb()
        .prepare("SELECT result_node_id FROM ai_review_items WHERE batch_id=?")
        .get(runningBatch.batch.id) as { result_node_id: string }
    ).result_node_id;
    expect(() =>
      resolution.saveLocalManualVerdict({
        runId: running.run.id,
        resultNodeId: runningNode,
        verdict: "problem",
      }),
    ).toThrowError(expect.objectContaining({ code: "AI_REVIEW_ACTIVE" }));
    dbModule
      .getDb()
      .prepare("UPDATE ai_review_batches SET status='completed' WHERE id=?")
      .run(runningBatch.batch.id);
    expect(
      resolution.saveLocalManualVerdict({
        runId: running.run.id,
        resultNodeId: runningNode,
        verdict: "not_problem",
      }).updated,
    ).toBe(false);
  });

  it("removes manually resolved items when create, resume, or retry revisits a batch", () => {
    const config = provider();
    for (const action of ["create", "resume", "retry"] as const) {
      const item = fixture(1, true);
      const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
      ai.pauseAiBatch(batch.batch.id);
      const nodeId = (
        dbModule
          .getDb()
          .prepare("SELECT result_node_id FROM ai_review_items WHERE batch_id=?")
          .get(batch.batch.id) as { result_node_id: string }
      ).result_node_id;
      resolution.saveLocalManualVerdict({
        runId: item.run.id,
        resultNodeId: nodeId,
        verdict: "not_problem",
      });
      if (action === "create")
        ai.createAiBatch({ runId: item.run.id, providerConfigId: config.id });
      if (action === "resume") ai.resumeAiBatch(batch.batch.id);
      if (action === "retry") {
        dbModule
          .getDb()
          .prepare("UPDATE ai_review_items SET status='failed' WHERE batch_id=?")
          .run(batch.batch.id);
        dbModule
          .getDb()
          .prepare("UPDATE ai_review_batches SET status='failed' WHERE id=?")
          .run(batch.batch.id);
        ai.retryAiBatch(batch.batch.id);
      }
      expect(
        (
          dbModule
            .getDb()
            .prepare("SELECT COUNT(*) count FROM ai_review_items WHERE batch_id=?")
            .get(batch.batch.id) as { count: number }
        ).count,
      ).toBe(0);
    }
  });

  it("keeps report statistics over the full node population", () => {
    const item = fixture(13, true);
    expect(report.buildRunReportDto(item.run.id).nodeStatistics.total).toBeGreaterThan(12);
  });

  it("uses rule-level node counts for aggregates and issue metadata", () => {
    const item = fixture(3, true, true);
    dbModule
      .getDb()
      .prepare("UPDATE rule_results SET node_count=4 WHERE run_id=? AND result_type='incomplete'")
      .run(item.run.id);

    const dto = report.buildRunReportDto(item.run.id);
    expect(dto.score.resultNodeCounts).toMatchObject({ pass: 1, incomplete: 4 });
    expect(dto.nodeStatistics).toMatchObject({ pass: 1, incomplete: 4, total: 5 });
    expect(dto.issues.find((issue) => issue.resultType === "incomplete")?.nodeCount).toBe(4);
    const html = report.renderRunReportHtml(dto);
    expect(html).toContain("优先整改事项");
    expect(html).toContain('class="issue-card');
    expect(html).not.toContain("全部节点证据");
    expect(html).toContain("尚无结论（原始 incomplete）");
    expect(html).not.toContain("null（已完成 AI）");
    const english = report.renderRunReportHtml(dto, "en");
    expect(english).toContain("No conclusion yet");
    expect(english).toContain("Raw incomplete inventory");
    expect(english).toContain("Report boundary");
    expect(english).not.toContain("扫描摘要");
    expect(english).not.toContain("报告边界");
    expect(english).not.toContain("原始 incomplete 清单");
    expect(english).not.toContain("尚无结论");
    expect(english).not.toContain("axe-core 无法在当前页面状态下自动给出通过或问题结论");
  });

  it("downloads a published report as JSON", async () => {
    const item = fixture(1, true, true);
    dbModule.getDb().prepare("UPDATE scan_runs SET published=1 WHERE id=?").run(item.run.id);

    const response = await reportJsonRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ runId: item.run.id }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.runId).toBe(item.run.id);
    expect(typeof payload.score.exact.overall.numerator).toBe("string");
  });

  it("rejects manual review mutations on published runs with a client error", async () => {
    const item = fixture(1, true);
    const nodeId = (
      dbModule
        .getDb()
        .prepare(
          "SELECT id FROM result_nodes WHERE rule_result_id IN (SELECT id FROM rule_results WHERE run_id=?)",
        )
        .get(item.run.id) as { id: string }
    ).id;
    dbModule.getDb().prepare("UPDATE scan_runs SET published=1 WHERE id=?").run(item.run.id);

    const response = await incompleteReviewRoute.POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verdict: "problem", note: "must remain unchanged" }),
      }),
      { params: Promise.resolve({ runId: item.run.id, nodeId }) },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "RUN_PUBLISHED_READ_ONLY" });
    const clearResponse = await incompleteReviewRoute.DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      { params: Promise.resolve({ runId: item.run.id, nodeId }) },
    );
    expect(clearResponse.status).toBe(409);
    expect((await clearResponse.json()).error).toMatchObject({ code: "RUN_PUBLISHED_READ_ONLY" });
    expect(
      (
        dbModule
          .getDb()
          .prepare("SELECT COUNT(*) AS count FROM manual_reviews WHERE result_node_id=?")
          .get(nodeId) as { count: number }
      ).count,
    ).toBe(0);
  });

  it("counts AI and manual conclusions as a de-duplicated union", () => {
    const item = fixture(2, true);
    const model = provider();
    const batch = ai.createAiBatch({ runId: item.run.id, providerConfigId: model.id });
    const nodes = dbModule
      .getDb()
      .prepare(
        "SELECT id FROM result_nodes WHERE rule_result_id IN (SELECT id FROM rule_results WHERE run_id=?) ORDER BY id",
      )
      .all(item.run.id) as Array<{ id: string }>;
    const timestamp = new Date().toISOString();
    dbModule
      .getDb()
      .prepare(
        "UPDATE ai_review_items SET status='completed',verdict='problem',completed_at=?,updated_at=? WHERE batch_id=?",
      )
      .run(timestamp, timestamp, batch.batch.id);
    dbModule
      .getDb()
      .prepare(
        "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,is_current,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `manual_overlap_${crypto.randomUUID()}`,
        nodes[0].id,
        null,
        "ad_hoc",
        "local",
        "not_problem",
        "override",
        1,
        1,
        timestamp,
      );

    const summary = resolution.summarizeIncompleteResolutions(item.run.id);
    expect(summary).toMatchObject({
      total: 2,
      aiResolved: 2,
      manualResolved: 1,
      resolved: 2,
      unresolved: 0,
    });
    const resolvedHtml = report.renderRunReportHtml(report.buildRunReportDto(item.run.id));
    expect(resolvedHtml).toContain("尚无结论");
    expect(resolvedHtml).not.toContain("需进一步确认</span><strong>2");
  });
});
