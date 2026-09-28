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

function fixture(nodeCount = 2) {
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
          nodes: Array.from({ length: nodeCount }, (_, index) => ({
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
  const timestamp = new Date().toISOString();
  const activeStartedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const runningAttemptId = `monitor-attempt-running-${crypto.randomUUID()}`;
  db.prepare("UPDATE ai_review_batches SET status='running' WHERE id=?").run(batch.batch.id);
  db.prepare(
    `UPDATE ai_review_items SET status='running',attempt_count=1,lease_owner=?,lease_until=?,active_attempt_id=?
     WHERE id=?`,
  ).run(workerId, new Date(Date.now() + 60_000).toISOString(), runningAttemptId, items[0].id);
  db.prepare(
    `INSERT INTO ai_worker_instances(worker_id,started_at,last_seen_at,stopped_at)
     VALUES (?,?,?,NULL)`,
  ).run(workerId, timestamp, timestamp);
  db.prepare(
    `INSERT INTO ai_api_attempts
       (id,worker_id,slot,run_id,batch_id,item_id,provider_config_id,provider_label,model,
        retry_cycle,attempt_number,started_at,send_started_at,status)
     VALUES (?, ?,2,?,?,?,?,?,?,0,1,?,?, 'running')`,
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
    expect(body.queueSummary).toMatchObject({
      queuedBatches: 0,
      runningBatches: 1,
      queuedItems: 1,
      runningItems: 1,
    });
    expect(body.historySummary).toMatchObject({
      batchStatusCounts: { running: 1 },
      itemStatusCounts: { queued: 1, running: 1 },
    });
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

  it("does not count expired-worker calls or leases as live and reports them as unconfirmed", async () => {
    const seeded = fixture();
    const db = dbModule.getDb();
    const stale = new Date(Date.now() - 11_000).toISOString();
    db.prepare("UPDATE ai_worker_instances SET last_seen_at=? WHERE worker_id=?").run(
      stale,
      seeded.workerId,
    );
    const response = await monitorRoute.GET(request(adminCookie));
    const body = await response.json();
    expect(body.activeCalls).not.toContainEqual(
      expect.objectContaining({ attemptId: seeded.runningAttemptId }),
    );
    expect(body.uncertainCalls).toContainEqual(
      expect.objectContaining({ attemptId: seeded.runningAttemptId, workerOnline: false }),
    );
    expect(
      body.workerStatus.workers.find(
        (worker: { workerId: string }) => worker.workerId === seeded.workerId,
      ).activeSlots,
    ).toBe(0);

    db.prepare("UPDATE ai_worker_instances SET last_seen_at=? WHERE worker_id=?").run(
      new Date().toISOString(),
      seeded.workerId,
    );
    db.prepare("UPDATE ai_review_items SET lease_until=? WHERE active_attempt_id=?").run(
      stale,
      seeded.runningAttemptId,
    );
    const expiredLeaseResponse = await monitorRoute.GET(request(adminCookie));
    const expiredLeaseBody = await expiredLeaseResponse.json();
    expect(expiredLeaseBody.activeCalls).not.toContainEqual(
      expect.objectContaining({ attemptId: seeded.runningAttemptId }),
    );
    expect(expiredLeaseBody.uncertainCalls).toContainEqual(
      expect.objectContaining({
        attemptId: seeded.runningAttemptId,
        workerOnline: true,
        sendState: "possibly_sent",
      }),
    );

    db.prepare("UPDATE ai_api_attempts SET send_started_at=NULL WHERE id=?").run(
      seeded.runningAttemptId,
    );
    const notSentResponse = await monitorRoute.GET(request(adminCookie));
    const notSentBody = await notSentResponse.json();
    expect(notSentBody.activeCalls).not.toContainEqual(
      expect.objectContaining({ attemptId: seeded.runningAttemptId }),
    );
    expect(notSentBody.uncertainCalls).toContainEqual(
      expect.objectContaining({
        attemptId: seeded.runningAttemptId,
        workerOnline: true,
        sendState: "unknown",
      }),
    );
  });

  it("distinguishes provider responses, explicit pre-send stops, and legacy unknown send state", async () => {
    const seeded = fixture();
    const db = dbModule.getDb();
    db.prepare(
      "UPDATE ai_api_attempts SET started_at=?,send_started_at=NULL,status='cancelled',error_code='AI_ATTEMPT_NOT_SENT' WHERE id=?",
    ).run(new Date().toISOString(), seeded.runningAttemptId);
    db.prepare(
      `INSERT INTO ai_api_attempts(id,worker_id,slot,provider_label,model,retry_cycle,attempt_number,started_at,status)
       VALUES ('legacy-no-send-marker',?,1,'Legacy provider','legacy-model',0,1,?,'failed')`,
    ).run(seeded.workerId, new Date().toISOString());

    const response = await monitorRoute.GET(request(adminCookie));
    const body = await response.json();

    expect(body.recentAttempts).toContainEqual(
      expect.objectContaining({ attemptId: seeded.runningAttemptId, sendState: "not_sent" }),
    );
    expect(body.recentAttempts).toContainEqual(
      expect.objectContaining({
        attemptId: "legacy-no-send-marker",
        status: "failed",
        httpStatus: null,
        sendState: "unknown",
      }),
    );
    expect(body.recentAttempts).toContainEqual(
      expect.objectContaining({
        status: "completed",
        httpStatus: 200,
        sendState: "response_received",
      }),
    );
  });

  it("keeps live queue counts separate from historical completed batch rows", async () => {
    const beforeResponse = await monitorRoute.GET(request(adminCookie));
    const before = await beforeResponse.json();
    const active = fixture();
    const historical = fixture();
    const db = dbModule.getDb();
    const completedAt = new Date().toISOString();
    db.prepare("UPDATE ai_review_batches SET status='completed',completed_at=? WHERE id=?").run(
      completedAt,
      historical.batchId,
    );
    db.prepare(
      "UPDATE ai_review_items SET status='completed',verdict='uncertain',completed_at=?,lease_owner=NULL,lease_until=NULL,active_attempt_id=NULL WHERE batch_id=?",
    ).run(completedAt, historical.batchId);
    db.prepare("UPDATE ai_api_attempts SET status='completed',ended_at=? WHERE run_id=?").run(
      completedAt,
      historical.runId,
    );

    const response = await monitorRoute.GET(request(adminCookie));
    const body = await response.json();
    expect(body.queueSummary).toMatchObject({
      runningBatches: before.queueSummary.runningBatches + 1,
      queuedItems: before.queueSummary.queuedItems + 1,
      runningItems: before.queueSummary.runningItems + 1,
    });
    expect(body.historySummary.batchStatusCounts.completed).toBe(
      before.historySummary.batchStatusCounts.completed + 1,
    );
    expect(body.historySummary.itemStatusCounts.completed).toBe(
      before.historySummary.itemStatusCounts.completed + 2,
    );
    expect(body.batches).toContainEqual(
      expect.objectContaining({ batchId: active.batchId, status: "running" }),
    );
    expect(body.batches).toContainEqual(
      expect.objectContaining({ batchId: historical.batchId, status: "completed" }),
    );
  });

  it("keeps failed items in history after human resolution excludes them from the queue", async () => {
    const seeded = fixture();
    const db = dbModule.getDb();
    const item = db
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? LIMIT 1")
      .get(seeded.batchId) as { id: string };

    db.prepare(
      "UPDATE ai_review_items SET status='failed',last_error='AI_PROVIDER_UNAVAILABLE' WHERE id=?",
    ).run(item.id);
    const failedResponse = await monitorRoute.GET(request(adminCookie));
    const failed = await failedResponse.json();

    db.prepare("UPDATE ai_review_items SET exclusion_reason='human_final' WHERE id=?").run(item.id);
    const excludedResponse = await monitorRoute.GET(request(adminCookie));
    const excluded = await excludedResponse.json();

    expect(excluded.historySummary.itemStatusCounts.failed).toBe(
      failed.historySummary.itemStatusCounts.failed,
    );
    expect(excluded.historySummary.totalItems).toBe(failed.historySummary.totalItems);
    expect(excluded.historySummary.excludedItems).toBe(failed.historySummary.excludedItems + 1);
    expect(excluded.queueSummary.failedItems).toBe(failed.queueSummary.failedItems - 1);
    expect(excluded.batches).toContainEqual(
      expect.objectContaining({
        batchId: seeded.batchId,
        itemCounts: expect.objectContaining({ failed: 1, total: 2, excludedItems: 1 }),
      }),
    );
  });

  it("retains send-start state on settled cancelled attempts in the audit trail", async () => {
    const seeded = fixture();
    const endedAt = new Date().toISOString();
    const startedAt = new Date(Date.now() - 2_000).toISOString();
    dbModule
      .getDb()
      .prepare(
        "UPDATE ai_api_attempts SET status='cancelled',started_at=?,send_started_at=?,cancelled_at=?,ended_at=? WHERE id=?",
      )
      .run(startedAt, startedAt, endedAt, endedAt, seeded.runningAttemptId);

    const response = await monitorRoute.GET(request(adminCookie));
    const body = await response.json();

    expect(body.activeCalls).not.toContainEqual(
      expect.objectContaining({ attemptId: seeded.runningAttemptId }),
    );
    expect(body.recentAttempts).toContainEqual(
      expect.objectContaining({
        attemptId: seeded.runningAttemptId,
        status: "cancelled",
        sendState: "possibly_sent",
        cancellationPending: false,
      }),
    );
  });

  it("keeps prior failures visible after pause while the started request settles only as itself", async () => {
    const seeded = fixture(3);
    const db = dbModule.getDb();
    const items = db
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
      .all(seeded.batchId) as Array<{ id: string }>;
    const failedAttemptId = `monitor-attempt-failed-${crypto.randomUUID()}`;
    const startedAt = new Date(Date.now() - 4_000).toISOString();
    const endedAt = new Date(Date.now() - 2_000).toISOString();
    db.prepare(
      `UPDATE ai_review_items SET status='failed',attempt_count=3,last_error='AI_PROVIDER_RATE_LIMITED',
       completed_at=?,updated_at=? WHERE id=?`,
    ).run(endedAt, endedAt, items[2].id);
    db.prepare(
      `INSERT INTO ai_api_attempts
         (id,worker_id,slot,run_id,batch_id,item_id,provider_config_id,provider_label,model,
          retry_cycle,attempt_number,started_at,send_started_at,ended_at,duration_ms,status,http_status,error_code)
       SELECT ?,a.worker_id,3,a.run_id,a.batch_id,?,a.provider_config_id,a.provider_label,a.model,
          0,3,?,?,?,2000,'failed',429,'AI_PROVIDER_RATE_LIMITED'
       FROM ai_api_attempts a WHERE a.id=?`,
    ).run(failedAttemptId, items[2].id, startedAt, startedAt, endedAt, seeded.runningAttemptId);

    const beforeResponse = await monitorRoute.GET(request(adminCookie));
    const before = await beforeResponse.json();
    const attemptsBefore = (
      db
        .prepare("SELECT COUNT(*) AS count FROM ai_api_attempts WHERE batch_id=?")
        .get(seeded.batchId) as { count: number }
    ).count;
    expect(before.batches).toContainEqual(
      expect.objectContaining({
        batchId: seeded.batchId,
        status: "running",
        itemCounts: expect.objectContaining({ failed: 1 }),
      }),
    );

    ai.pauseAiBatch(seeded.batchId);

    const afterResponse = await monitorRoute.GET(request(adminCookie));
    const after = await afterResponse.json();
    expect(after.queueSummary.queuedItems).toBe(before.queueSummary.queuedItems - 1);
    expect(after.queueSummary.runningItems).toBe(before.queueSummary.runningItems - 1);
    expect(after.queueSummary.failedItems).toBe(before.queueSummary.failedItems - 1);
    expect(after.historySummary.itemStatusCounts.failed).toBe(
      before.historySummary.itemStatusCounts.failed,
    );
    expect(after.batches).toContainEqual(
      expect.objectContaining({
        batchId: seeded.batchId,
        status: "paused",
        itemCounts: expect.objectContaining({ queued: 1, running: 1, failed: 1 }),
      }),
    );
    expect(after.activeCalls).toContainEqual(
      expect.objectContaining({
        attemptId: seeded.runningAttemptId,
        cancellationPending: true,
        retryCycle: 0,
      }),
    );
    expect(after.recentAttempts).toContainEqual(
      expect.objectContaining({
        attemptId: failedAttemptId,
        itemId: items[2].id.slice(0, 12),
        attemptNumber: 3,
        retryCycle: 0,
        errorCode: "AI_PROVIDER_RATE_LIMITED",
      }),
    );
    expect(
      db.prepare("SELECT status,last_error FROM ai_review_items WHERE id=?").get(items[2].id) as {
        status: string;
        last_error: string;
      },
    ).toEqual({ status: "failed", last_error: "AI_PROVIDER_RATE_LIMITED" });
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM ai_api_attempts WHERE batch_id=?")
          .get(seeded.batchId) as {
          count: number;
        }
      ).count,
    ).toBe(attemptsBefore);
  });

  it("keeps one process heartbeat online for all active slots and marks it stopped", async () => {
    vi.useFakeTimers();
    const seeded = fixture(16);
    const workerId = seeded.workerId;
    const db = dbModule.getDb();
    const stale = new Date(Date.now() - 20_000).toISOString();
    db.prepare("UPDATE ai_worker_instances SET last_seen_at=? WHERE worker_id=?").run(
      stale,
      workerId,
    );
    const batchItems = db
      .prepare("SELECT id FROM ai_review_items WHERE batch_id=? ORDER BY id")
      .all(seeded.batchId) as Array<{ id: string }>;
    const insertAttempt = db.prepare(
      `INSERT INTO ai_api_attempts
         (id,worker_id,slot,run_id,batch_id,item_id,provider_config_id,provider_label,model,
          retry_cycle,attempt_number,started_at,send_started_at,status)
       SELECT ?,?, ?,run_id,?,?,provider_config_id,'fixture provider','fixture-model',0,1,?,?,'running'
       FROM ai_review_batches WHERE id=?`,
    );
    for (let index = 0; index < batchItems.length; index += 1) {
      const item = batchItems[index];
      const attemptId = index === 0 ? seeded.runningAttemptId : `${workerId}-attempt-${index + 1}`;
      const slot = index + 1;
      db.prepare(
        "UPDATE ai_review_items SET status='running',active_attempt_id=?,lease_owner=?,lease_until=? WHERE id=?",
      ).run(attemptId, workerId, new Date(Date.now() + 60_000).toISOString(), item.id);
      if (index === 0) {
        db.prepare("UPDATE ai_api_attempts SET slot=? WHERE id=?").run(slot, attemptId);
      } else {
        insertAttempt.run(
          attemptId,
          workerId,
          slot,
          seeded.batchId,
          item.id,
          new Date().toISOString(),
          new Date().toISOString(),
          seeded.batchId,
        );
      }
    }

    const writesBefore = (db.prepare("SELECT total_changes() AS total").get() as { total: number })
      .total;
    const heartbeat = ai.startAiWorkerHeartbeat(workerId);
    try {
      vi.advanceTimersByTime(9_000);
      const writesAfter = (db.prepare("SELECT total_changes() AS total").get() as { total: number })
        .total;
      expect(writesAfter - writesBefore).toBe(4);
      const workerRows = db
        .prepare(
          "SELECT worker_id,last_seen_at,stopped_at FROM ai_worker_instances WHERE worker_id=?",
        )
        .all(workerId) as Array<{
        worker_id: string;
        last_seen_at: string;
        stopped_at: string | null;
      }>;
      expect(workerRows).toHaveLength(1);
      expect(Date.now() - Date.parse(workerRows[0].last_seen_at)).toBeLessThanOrEqual(10_000);
      expect(workerRows[0].stopped_at).toBeNull();

      const response = await monitorRoute.GET(request(adminCookie));
      const body = await response.json();
      const activeCalls = body.activeCalls.filter(
        (call: { workerId: string }) => call.workerId === workerId,
      );
      expect(activeCalls).toHaveLength(16);
      expect(activeCalls.map((call: { slot: number }) => call.slot)).toEqual(
        Array.from({ length: 16 }, (_, index) => index + 1),
      );
      expect(activeCalls.every((call: { workerOnline: boolean }) => call.workerOnline)).toBe(true);
    } finally {
      heartbeat.stop();
      vi.useRealTimers();
    }

    const stoppedRows = db
      .prepare("SELECT stopped_at FROM ai_worker_instances WHERE worker_id=?")
      .all(workerId) as Array<{ stopped_at: string | null }>;
    expect(stoppedRows).toHaveLength(1);
    expect(stoppedRows[0].stopped_at).not.toBeNull();
  });

  it("catches periodic heartbeat database failures without logging error details", () => {
    vi.useFakeTimers();
    const db = dbModule.getDb();
    const workerId = `idle-error-worker-${crypto.randomUUID()}`;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const heartbeat = ai.startAiWorkerHeartbeat(workerId);
    try {
      db.exec(`CREATE TEMP TRIGGER fail_ai_worker_heartbeat BEFORE UPDATE ON ai_worker_instances
        WHEN NEW.worker_id='${workerId}' BEGIN SELECT RAISE(FAIL,'private database detail'); END;`);
      vi.advanceTimersByTime(3_000);
      expect(log).toHaveBeenCalledWith("AI worker heartbeat failed");
      expect(log.mock.calls.flat().join(" ")).not.toContain("private database detail");
      db.exec("DROP TRIGGER fail_ai_worker_heartbeat");
      vi.advanceTimersByTime(3_000);
      expect(
        db.prepare("SELECT stopped_at FROM ai_worker_instances WHERE worker_id=?").get(workerId),
      ).toMatchObject({ stopped_at: null });
    } finally {
      db.exec("DROP TRIGGER IF EXISTS fail_ai_worker_heartbeat");
      heartbeat.stop();
      log.mockRestore();
      vi.useRealTimers();
    }
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
