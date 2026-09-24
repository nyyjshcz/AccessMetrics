import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accessmetrics-ai-worker-monitor-"));
process.env.APP_ENV = "test";
process.env.DATABASE_URL = path.join(testRoot, "ai-worker-monitor.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(testRoot, "private");
process.env.PUBLIC_EXPORT_ROOT = path.join(testRoot, "public");
process.env.SESSION_SECRET = "ai-worker-monitor-session-secret-0123456789";
process.env.ADMIN_ACCESS_KEY = "ai-worker-monitor-admin-key-0123456789";
process.env.VISITOR_ACCESS_KEY = "ai-worker-monitor-visitor-key-0123456789";

const dbModule = await import("@/lib/db");
const repositories = await import("@/lib/repositories");
const ai = await import("@/lib/ai-overlay");
const access = await import("@/lib/access-control");
const monitorRoute = await import("@/app/api/ai/worker/route");

const adminCookie = `accesscheck_session=${access.createAccessSession({ role: "admin", source: "admin" })}`;
const visitorCookie = `accesscheck_session=${access.createAccessSession({ role: "visitor", source: "visitor" })}`;

function request(cookie?: string) {
  return new Request("http://localhost/api/ai/worker", {
    headers: cookie ? { cookie } : {},
  });
}

function fixture() {
  const origin = `https://monitor-${crypto.randomUUID()}.example`;
  const job = repositories.createScanJob(
    origin,
    { maxPages: 1, sameOriginOnly: true, respectRobots: true },
    undefined,
    undefined,
    `${origin}/private/path?token=must-not-leak`,
  );
  const run = repositories.createRun(job);
  const pageId = `page_${crypto.randomUUID()}`;
  dbModule
    .getDb()
    .prepare("INSERT INTO pages(id,site_id,canonical_url,first_seen_at) VALUES (?,?,?,?)")
    .run(pageId, job.site_id, `${origin}/`, new Date().toISOString());
  repositories.savePageResult(run.id, pageId, {
    url: `${origin}/private/path?token=must-not-leak`,
    finalUrl: `${origin}/private/path?token=must-not-leak`,
    title: "Monitor fixture",
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
          nodes: [0, 1].map((index) => ({
            html: `<img data-monitor="${index}">`,
            target: [`img[data-monitor="${index}"]`],
            any: [],
            all: [],
            none: [],
          })),
        },
      ],
      inapplicable: [],
    },
  });
  const provider = ai.saveAiProvider({
    label: "Monitor provider",
    baseUrl: "https://private-provider.example/v1",
    model: "monitor-model",
    apiKey: "monitor-secret-provider-key",
    enabled: true,
  });
  const batch = ai.createAiBatch({ runId: run.id, providerConfigId: provider.id });
  const workerId = `monitor-worker-${crypto.randomUUID()}`;
  const db = dbModule.getDb();
  const items = db
    .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
    .all(batch.batch.id) as Array<{ id: string }>;
  db.prepare("UPDATE ai_review_batches SET status='running' WHERE id=?").run(batch.batch.id);
  db.prepare(
    "UPDATE ai_review_items SET status='running',lease_owner=?,lease_until=? WHERE id=?",
  ).run(workerId, new Date(Date.now() + 60_000).toISOString(), items[0].id);

  const timestamp = new Date().toISOString();
  const activeStartedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const runningAttemptId = `monitor-attempt-running-${crypto.randomUUID()}`;
  db.prepare(
    `INSERT INTO ai_worker_instances(worker_id,started_at,last_seen_at,stopped_at)
     VALUES (?,?,?,NULL)`,
  ).run(workerId, timestamp, timestamp);
  db.prepare(
    `INSERT INTO ai_api_attempts
       (id,worker_id,slot,run_id,batch_id,item_id,provider_config_id,provider_label,model,
        retry_cycle,attempt_number,started_at,status)
     VALUES (?, ?,2,?,?,?,?,?,?,0,1,?,'running')`,
  ).run(
    runningAttemptId,
    workerId,
    run.id,
    batch.batch.id,
    items[0].id,
    provider.id,
    provider.label,
    provider.model,
    activeStartedAt,
  );
  const completedAt = new Date(Date.now() - 5_000).toISOString();
  db.prepare(
    `INSERT INTO ai_api_attempts
       (id,worker_id,slot,run_id,batch_id,item_id,provider_config_id,provider_label,model,
        retry_cycle,attempt_number,started_at,ended_at,duration_ms,status,http_status,
        input_tokens,output_tokens,total_tokens,reported_cost,currency)
     VALUES (?, ?,1,?,?,?,?,?,?,0,1,?,?,5000,'completed',200,20,10,30,0.12,'USD')`,
  ).run(
    `monitor-attempt-completed-${crypto.randomUUID()}`,
    workerId,
    run.id,
    batch.batch.id,
    items[1].id,
    provider.id,
    provider.label,
    provider.model,
    completedAt,
    timestamp,
  );
  return {
    runId: run.id,
    batchId: batch.batch.id,
    origin,
    submittedUrl: job.submitted_url,
    workerId,
    runningAttemptId,
  };
}

describe("admin AI Worker monitor", () => {
  beforeAll(() => dbModule.migrate());
  afterAll(() => dbModule.closeDb());

  it("requires an admin session", async () => {
    expect((await monitorRoute.GET(request())).status).toBe(401);
    const visitor = await monitorRoute.GET(request(visitorCookie));
    expect(visitor.status).toBe(403);
    expect((await monitorRoute.GET(request(adminCookie))).status).toBe(200);
  });

  it("shows heartbeat, active calls, batch counts and provider-reported usage without leaking URLs or secrets", async () => {
    const seeded = fixture();
    const db = dbModule.getDb();
    const addCompletedAttempt = db.prepare(
      `INSERT INTO ai_api_attempts
         (id,worker_id,slot,provider_label,model,retry_cycle,attempt_number,started_at,status)
       VALUES (?, ?,1,'Monitor provider','monitor-model',0,1,?,'completed')`,
    );
    for (let index = 0; index < 101; index += 1) {
      addCompletedAttempt.run(
        `monitor-history-${crypto.randomUUID()}`,
        seeded.workerId,
        new Date(Date.now() - index * 1000).toISOString(),
      );
    }
    const response = await monitorRoute.GET(request(adminCookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workerStatus.workers).toContainEqual(
      expect.objectContaining({ workerId: seeded.workerId, online: true }),
    );
    expect(body.activeCalls).toContainEqual(
      expect.objectContaining({
        attemptId: seeded.runningAttemptId,
        workerId: seeded.workerId,
        slot: 2,
        scanId: seeded.runId,
        scanHost: new URL(seeded.origin).host,
        model: "monitor-model",
        cancellationPending: false,
      }),
    );
    expect(body.recentAttempts).toHaveLength(100);
    expect(body.recentAttempts).not.toContainEqual(
      expect.objectContaining({ attemptId: seeded.runningAttemptId }),
    );
    expect(body.batches).toContainEqual(
      expect.objectContaining({
        batchId: seeded.batchId,
        scanId: seeded.runId,
        scanHost: new URL(seeded.origin).host,
        status: "running",
        itemCounts: expect.objectContaining({ queued: 1, running: 1 }),
      }),
    );
    expect(body.itemSummary).toMatchObject({ queued: 1, running: 1 });
    expect(body.usageSummary).toMatchObject({
      attempts: 103,
      providerReportedCost: [{ currency: "USD", amount: 0.12 }],
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
    expect(body.recentAttempts).toContainEqual(
      expect.objectContaining({
        model: "monitor-model",
        status: "completed",
        httpStatus: 200,
        totalTokens: 30,
        reportedCost: 0.12,
        currency: "USD",
      }),
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("/private/path");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("monitor-secret-provider-key");
    expect(serialized).not.toContain("private-provider.example");
  });

  it("marks a worker offline when its heartbeat is older than ten seconds", async () => {
    const stale = new Date(Date.now() - 11_000).toISOString();
    dbModule
      .getDb()
      .prepare(
        "INSERT INTO ai_worker_instances(worker_id,started_at,last_seen_at,stopped_at) VALUES (?,?,?,NULL)",
      )
      .run("monitor-stale-worker", stale, stale);
    const response = await monitorRoute.GET(request(adminCookie));
    const body = await response.json();
    expect(body.workerStatus.workers).toContainEqual(
      expect.objectContaining({ workerId: "monitor-stale-worker", online: false }),
    );
  });

  it("serves repeated polls without database writes or provider network calls", async () => {
    fixture();
    const db = dbModule.getDb();
    const before = (db.prepare("SELECT total_changes() AS total").get() as { total: number }).total;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      expect((await monitorRoute.GET(request(adminCookie))).status).toBe(200);
      expect((await monitorRoute.GET(request(adminCookie))).status).toBe(200);
      expect((db.prepare("SELECT total_changes() AS total").get() as { total: number }).total).toBe(
        before,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
