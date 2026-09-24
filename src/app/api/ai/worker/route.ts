import { NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/access-control";
import { getDb } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

export const dynamic = "force-dynamic";

type WorkerRow = {
  worker_id: string;
  started_at: string;
  last_seen_at: string;
  stopped_at: string | null;
};

type BatchRow = {
  id: string;
  run_id: string | null;
  status: string;
  provider_snapshot_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  scan_host: string | null;
  queued: number;
  running: number;
  completed: number;
  failed: number;
};

type AttemptRow = {
  id: string;
  worker_id: string;
  slot: number;
  run_id: string | null;
  batch_id: string | null;
  provider_label: string;
  model: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  status: string;
  http_status: number | null;
  error_code: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  reported_cost: number | null;
  currency: string | null;
  cancelled_at: string | null;
  scan_host: string | null;
};

function safeHost(origin: string | null | undefined) {
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

function providerSnapshot(value: string) {
  try {
    const parsed = JSON.parse(value) as { label?: unknown; model?: unknown };
    return {
      provider: typeof parsed.label === "string" ? parsed.label : "Unknown provider",
      model: typeof parsed.model === "string" ? parsed.model : "Unknown model",
    };
  } catch {
    return { provider: "Unknown provider", model: "Unknown model" };
  }
}

function safeErrorCode(value: string | null) {
  return value && /^[A-Z0-9_]{1,80}$/.test(value) ? value : null;
}

export async function GET(request: Request) {
  try {
    requireRequestRole(request, "admin");
    const db = getDb();
    const now = Date.now();
    const workers = (
      db
        .prepare(
          `SELECT worker_id,started_at,last_seen_at,stopped_at
         FROM ai_worker_instances ORDER BY last_seen_at DESC LIMIT 100`,
        )
        .all() as WorkerRow[]
    ).map((worker) => ({
      workerId: worker.worker_id,
      startedAt: worker.started_at,
      lastSeenAt: worker.last_seen_at,
      stoppedAt: worker.stopped_at,
      online:
        worker.stopped_at === null &&
        Number.isFinite(Date.parse(worker.last_seen_at)) &&
        now - Date.parse(worker.last_seen_at) <= 10_000,
    }));

    const batches = (
      db
        .prepare(
          `SELECT b.id,b.run_id,b.status,b.provider_snapshot_json,b.created_at,b.updated_at,b.completed_at,
           s.origin AS scan_origin,
           SUM(CASE WHEN i.status='queued' THEN 1 ELSE 0 END) AS queued,
           SUM(CASE WHEN i.status='running' THEN 1 ELSE 0 END) AS running,
           SUM(CASE WHEN i.status='completed' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN i.status='failed' THEN 1 ELSE 0 END) AS failed
         FROM ai_review_batches b
         LEFT JOIN scan_runs r ON r.id=b.run_id
         LEFT JOIN sites s ON s.id=r.site_id
         LEFT JOIN ai_review_items i ON i.batch_id=b.id
         GROUP BY b.id
         ORDER BY b.updated_at DESC LIMIT 100`,
        )
        .all() as Array<BatchRow & { scan_origin: string | null }>
    ).map((batch) => {
      const provider = providerSnapshot(batch.provider_snapshot_json);
      const itemCounts = {
        queued: Number(batch.queued ?? 0),
        running: Number(batch.running ?? 0),
        completed: Number(batch.completed ?? 0),
        failed: Number(batch.failed ?? 0),
      };
      return {
        batchId: batch.id,
        scanId: batch.run_id,
        scanHost: safeHost(batch.scan_origin),
        provider: provider.provider,
        model: provider.model,
        status: batch.status,
        itemCounts: {
          ...itemCounts,
          total: Object.values(itemCounts).reduce((sum, count) => sum + count, 0),
        },
        createdAt: batch.created_at,
        updatedAt: batch.updated_at,
        completedAt: batch.completed_at,
      };
    });

    const recentAttemptRows = db
      .prepare(
        `SELECT a.id,a.worker_id,a.slot,a.run_id,a.batch_id,a.provider_label,a.model,
           a.started_at,a.ended_at,a.duration_ms,a.status,a.http_status,a.error_code,
           a.input_tokens,a.output_tokens,a.total_tokens,a.reported_cost,a.currency,a.cancelled_at,
           s.origin AS scan_origin
         FROM ai_api_attempts a
         LEFT JOIN scan_runs r ON r.id=a.run_id
         LEFT JOIN sites s ON s.id=r.site_id
         ORDER BY a.started_at DESC LIMIT 100`,
      )
      .all() as Array<AttemptRow & { scan_origin: string | null }>;

    const activeAttemptRows = db
      .prepare(
        `SELECT a.id,a.worker_id,a.slot,a.run_id,a.batch_id,a.provider_label,a.model,
           a.started_at,a.ended_at,a.duration_ms,a.status,a.http_status,a.error_code,
           a.input_tokens,a.output_tokens,a.total_tokens,a.reported_cost,a.currency,a.cancelled_at,
           s.origin AS scan_origin
         FROM ai_api_attempts a
         LEFT JOIN scan_runs r ON r.id=a.run_id
         LEFT JOIN sites s ON s.id=r.site_id
         WHERE a.status='running'
         ORDER BY a.started_at ASC`,
      )
      .all() as Array<AttemptRow & { scan_origin: string | null }>;

    const formatAttempt = (attempt: AttemptRow & { scan_origin: string | null }) => ({
      attemptId: attempt.id,
      workerId: attempt.worker_id,
      slot: Number(attempt.slot),
      scanId: attempt.run_id,
      scanHost: safeHost(attempt.scan_origin),
      batchId: attempt.batch_id,
      provider: attempt.provider_label,
      model: attempt.model,
      startedAt: attempt.started_at,
      endedAt: attempt.ended_at,
      durationMs: attempt.duration_ms,
      elapsedMs:
        attempt.status === "running" ? Math.max(0, now - Date.parse(attempt.started_at)) : null,
      status: attempt.status,
      httpStatus: attempt.http_status,
      errorCode: safeErrorCode(attempt.error_code),
      inputTokens: attempt.input_tokens,
      outputTokens: attempt.output_tokens,
      totalTokens: attempt.total_tokens,
      reportedCost: attempt.reported_cost,
      currency: attempt.currency,
      cancellationPending: Boolean(attempt.cancelled_at) && attempt.status === "running",
    });
    const recentAttempts = recentAttemptRows.map(formatAttempt);
    const onlineWorkerIds = new Set(
      workers.filter((worker) => worker.online).map((worker) => worker.workerId),
    );
    const activeCalls = activeAttemptRows.map((attempt) => ({
      ...formatAttempt(attempt),
      workerOnline: onlineWorkerIds.has(attempt.worker_id),
    }));

    const usageTotals = db
      .prepare(
        `SELECT COUNT(*) AS attempts,
           SUM(CASE WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL OR total_tokens IS NOT NULL THEN 1 ELSE 0 END) AS usage_reported_attempts,
           SUM(CASE WHEN reported_cost IS NOT NULL AND currency IS NOT NULL THEN 1 ELSE 0 END) AS cost_reported_attempts,
           SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,SUM(total_tokens) AS total_tokens
         FROM ai_api_attempts`,
      )
      .get() as {
      attempts: number;
      usage_reported_attempts: number;
      cost_reported_attempts: number;
      input_tokens: number | null;
      output_tokens: number | null;
      total_tokens: number | null;
    };
    const costTotals = db
      .prepare(
        `SELECT currency,SUM(reported_cost) AS amount FROM ai_api_attempts
         WHERE reported_cost IS NOT NULL AND currency IS NOT NULL GROUP BY currency`,
      )
      .all() as Array<{ currency: string; amount: number }>;
    const usageSummary = {
      attempts: Number(usageTotals.attempts),
      usageReportedAttempts: Number(usageTotals.usage_reported_attempts ?? 0),
      costReportedAttempts: Number(usageTotals.cost_reported_attempts ?? 0),
      inputTokens: usageTotals.input_tokens,
      outputTokens: usageTotals.output_tokens,
      totalTokens: usageTotals.total_tokens,
      providerReportedCost: costTotals,
    };

    const statusCounts = db
      .prepare("SELECT status,COUNT(*) AS count FROM ai_review_batches GROUP BY status")
      .all() as Array<{ status: string; count: number }>;
    const batchSummary = Object.fromEntries(
      ["queued", "running", "paused", "completed", "failed", "cancelled"].map((status) => [
        status,
        Number(statusCounts.find((item) => item.status === status)?.count ?? 0),
      ]),
    );
    const itemStatusCounts = db
      .prepare("SELECT status,COUNT(*) AS count FROM ai_review_items GROUP BY status")
      .all() as Array<{ status: string; count: number }>;
    const itemSummary = Object.fromEntries(
      ["queued", "running", "completed", "failed"].map((status) => [
        status,
        Number(itemStatusCounts.find((item) => item.status === status)?.count ?? 0),
      ]),
    );

    return NextResponse.json(
      {
        observedAt: new Date(now).toISOString(),
        workerStatus: {
          onlineWorkers: workers.filter((worker) => worker.online).length,
          workers: workers.map((worker) => ({
            ...worker,
            activeSlots: activeCalls.filter((attempt) => attempt.workerId === worker.workerId)
              .length,
          })),
        },
        activeCalls,
        batchSummary,
        itemSummary,
        batches,
        usageSummary,
        recentAttempts,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
