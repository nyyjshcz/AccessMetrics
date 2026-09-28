"use client";

import { useEffect, useRef, useState } from "react";
import { formatAiStopReason, getMessages, type Locale } from "@/lib/i18n";

type Worker = {
  workerId: string;
  startedAt: string;
  lastSeenAt: string;
  stoppedAt: string | null;
  online: boolean;
  activeSlots: number;
};
type SendState = "response_received" | "possibly_sent" | "not_sent" | "unknown";
type Call = {
  attemptId: string;
  workerId: string;
  slot: number;
  itemId: string | null;
  attemptNumber: number;
  retryCycle: number;
  scanId: string | null;
  scanHost: string | null;
  batchId: string | null;
  provider: string;
  model: string;
  startedAt: string;
  sendState: SendState;
  elapsedMs: number | null;
  status: string;
  workerOnline: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  cancellationPending: boolean;
};
type ItemCounts = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  excludedItems: number;
  total: number;
};
type Batch = {
  batchId: string;
  scanId: string | null;
  scanHost: string | null;
  provider: string;
  model: string;
  status: string;
  itemCounts: ItemCounts;
  createdAt: string;
  updatedAt: string;
  stopReason: string | null;
  stopRequestedAt: string | null;
};
type Attempt = {
  attemptId: string;
  itemId: string | null;
  sendState: SendState;
  attemptNumber: number;
  retryCycle: number;
  scanHost: string | null;
  provider: string;
  model: string;
  startedAt: string;
  durationMs: number | null;
  elapsedMs: number | null;
  status: string;
  httpStatus: number | null;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reportedCost: number | null;
  currency: string | null;
  cancellationPending: boolean;
};
type MonitorData = {
  observedAt: string;
  workerStatus: { onlineWorkers: number; workers: Worker[] };
  activeCalls: Call[];
  uncertainCalls: Call[];
  queueSummary: {
    queuedBatches: number;
    runningBatches: number;
    queuedItems: number;
    runningItems: number;
    failedItems: number;
  };
  historySummary: {
    batchStatusCounts: Record<string, number>;
    itemStatusCounts: Record<string, number>;
    excludedItems: number;
    totalBatches: number;
    totalItems: number;
  };
  batches: Batch[];
  usageSummary: {
    attempts: number;
    usageReportedAttempts: number;
    costReportedAttempts: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    providerReportedCost: Array<{ currency: string; amount: number }>;
  };
  recentAttempts: Attempt[];
};

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(date);
}

function formatDuration(value: number | null, locale: Locale) {
  if (value === null || !Number.isFinite(value)) return "—";
  const seconds = Math.floor(Math.max(0, value) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return locale === "en" ? `${minutes}m ${seconds % 60}s` : `${minutes}分${seconds % 60}秒`;
}

function countText(value: number | undefined, template: string) {
  return template.replace("{count}", String(value ?? 0));
}

export default function AiWorkerMonitorClient({ locale }: { locale: Locale }) {
  const copy = getMessages(locale).ai;
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      controller = new AbortController();
      try {
        const response = await fetch("/api/ai/worker", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            typeof body?.error?.message === "string" ? body.error.message : copy.refreshFailed,
          );
        if (active) {
          setData(body as MonitorData);
          setError(null);
          setLoading(false);
        }
      } catch (cause) {
        if (active && !(cause instanceof Error && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : copy.refreshFailed);
          setLoading(false);
        }
      } finally {
        inFlight.current = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [copy.refreshFailed]);

  const statusLabels: Record<string, string> = {
    queued: copy.queued,
    running: copy.running,
    paused: copy.paused,
    completed: copy.completed,
    failed: copy.failed,
    cancelled: copy.cancelled,
  };
  const statusLabel = (status: string) => statusLabels[status] ?? status;
  const sendStateLabel = (state: SendState) =>
    ({
      response_received: copy.providerResponseReceived,
      possibly_sent: copy.requestMayHaveBeenSent,
      not_sent: copy.requestNotSent,
      unknown: copy.sendStatusUnknown,
    })[state];
  const statusClass = (status: string) =>
    status === "running"
      ? "status-badge-active"
      : status === "completed"
        ? "status-badge-success"
        : status === "failed" || status === "cancelled"
          ? "status-badge-danger"
          : "status-badge-warning";

  return (
    <div className="ai-worker-content">
      <section className="card ai-worker-section">
        <div className="ai-worker-section-heading">
          <div>
            <p className="eyebrow">WORKER HEARTBEAT</p>
            <h2>{copy.workerMonitor}</h2>
          </div>
          <span
            role="status"
            className={`status-badge ${data?.workerStatus.onlineWorkers ? "status-badge-active" : "status-badge-warning"}`}
          >
            {data?.workerStatus.onlineWorkers ? copy.workerOnline : copy.workerOffline}
          </span>
        </div>
        {loading && !data ? <p className="muted">{copy.loading}</p> : null}
        {error && data ? (
          <p className="notice" role="status">
            {copy.staleData.replace("{time}", formatDate(data.observedAt, locale))}
          </p>
        ) : error ? (
          <p className="error notice" role="alert">
            {error}
          </p>
        ) : null}
        {data?.workerStatus.workers.length ? (
          <div className="ai-worker-list">
            {data.workerStatus.workers.map((worker) => (
              <div className="ai-worker-row" key={worker.workerId}>
                <span
                  className={`ai-worker-dot ${worker.online ? "is-online" : ""}`}
                  aria-hidden="true"
                />
                <code>{worker.workerId}</code>
                <span className="muted">
                  {copy.lastHeartbeat}: {formatDate(worker.lastSeenAt, locale)}
                </span>
                <span className="pill">{countText(worker.activeSlots, copy.workerSlots)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{copy.noWorkerHeartbeat}</p>
        )}
      </section>

      <section className="card ai-worker-section">
        <div className="ai-worker-section-heading">
          <div>
            <p className="eyebrow">LIVE REQUESTS</p>
            <h2>{copy.activeCalls}</h2>
          </div>
          <span className="pill">{countText(data?.activeCalls.length, copy.total)}</span>
        </div>
        {data?.activeCalls.length ? (
          <div className="ai-worker-active-list">
            {data.activeCalls.map((call) => (
              <article className="ai-worker-active-call" key={call.attemptId}>
                <div className="ai-worker-active-marker" aria-hidden="true" />
                <div className="ai-worker-call-main">
                  <div className="ai-worker-call-title">
                    <strong>{call.provider}</strong>
                    <span className="muted">{call.model}</span>
                    <span
                      className={`status-badge ${call.workerOnline ? "status-badge-active" : "status-badge-warning"}`}
                    >
                      {statusLabel(call.status)}
                    </span>
                  </div>
                  <p className="muted">
                    {copy.scan}: {call.scanHost ?? "—"} · {call.scanId?.slice(0, 12) ?? "—"} ·{" "}
                    {copy.elapsed}: {formatDuration(call.elapsedMs, locale)}
                  </p>
                  <p className="muted">
                    Worker {call.workerId}
                    {call.batchId ? ` · Batch ${call.batchId.slice(0, 12)}` : ""}
                    {call.itemId
                      ? ` · ${copy.itemAttempt.replace("{item}", call.itemId).replace("{attempt}", String(call.attemptNumber))}`
                      : ""}
                    {` · ${copy.retryCycle.replace("{cycle}", String(call.retryCycle + 1))}`}
                  </p>
                  {call.cancellationPending ? <p className="notice">{copy.cancelPending}</p> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">{copy.noActiveCalls}</p>
        )}
      </section>

      {data?.uncertainCalls.length ? (
        <section className="card ai-worker-section">
          <div className="ai-worker-section-heading">
            <div>
              <p className="eyebrow">REQUEST STATE</p>
              <h2>{copy.uncertainCalls}</h2>
              <p className="muted">{copy.uncertainCallsLede}</p>
            </div>
            <span className="pill">{countText(data.uncertainCalls.length, copy.total)}</span>
          </div>
          <div className="ai-worker-active-list">
            {data.uncertainCalls.map((call) => (
              <article className="ai-worker-active-call" key={call.attemptId}>
                <div className="ai-worker-active-marker" aria-hidden="true" />
                <div className="ai-worker-call-main">
                  <div className="ai-worker-call-title">
                    <strong>{call.provider}</strong>
                    <span className="muted">{call.model}</span>
                    <span className="status-badge status-badge-warning">{copy.staleRequest}</span>
                  </div>
                  <p className="muted">
                    {copy.scan}: {call.scanHost ?? "—"} · Worker {call.workerId} · {copy.elapsed}:{" "}
                    {formatDuration(call.elapsedMs, locale)}
                  </p>
                  <p className="muted">{sendStateLabel(call.sendState)}</p>
                  {call.itemId ? (
                    <p className="muted">
                      {copy.itemAttempt
                        .replace("{item}", call.itemId)
                        .replace("{attempt}", String(call.attemptNumber))}
                      {` · ${copy.retryCycle.replace("{cycle}", String(call.retryCycle + 1))}`}
                    </p>
                  ) : null}
                  {call.cancellationPending ? <p className="notice">{copy.cancelPending}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card ai-worker-section">
        <div className="ai-worker-section-heading">
          <div>
            <p className="eyebrow">QUEUE SNAPSHOT</p>
            <h2>{copy.currentQueue}</h2>
            <p className="muted">{copy.currentQueueScope}</p>
          </div>
          {data ? (
            <span className="muted">
              {copy.observedAt}: {formatDate(data.observedAt, locale)}
            </span>
          ) : null}
        </div>
        <div className="ai-worker-count-strip" aria-label={copy.currentQueue}>
          {(
            [
              [copy.queued, data?.queueSummary.queuedBatches, locale === "en" ? "batches" : "批次"],
              [
                copy.running,
                data?.queueSummary.runningBatches,
                locale === "en" ? "batches" : "批次",
              ],
              [copy.queued, data?.queueSummary.queuedItems, copy.items],
              [copy.running, data?.queueSummary.runningItems, copy.items],
              [copy.failed, data?.queueSummary.failedItems, copy.items],
            ] as const
          ).map(([label, count, unit], index) => (
            <div className="ai-worker-count" key={`queue-${index}`}>
              <span>{label}</span>
              <strong>{count ?? 0}</strong>
              <small>{unit}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="card ai-worker-section">
        <div className="ai-worker-section-heading">
          <div>
            <p className="eyebrow">HISTORY</p>
            <h2>{copy.history}</h2>
            <p className="muted">{copy.historyScope}</p>
          </div>
          <span className="muted">
            {copy.batches}: {data?.historySummary.totalBatches ?? 0} · {copy.items}:{" "}
            {data?.historySummary.totalItems ?? 0}
          </span>
        </div>
        <div className="ai-worker-item-summary">
          <strong>{copy.lifecycle}</strong>
          {(["queued", "running", "paused", "completed", "failed", "cancelled"] as const).map(
            (status) => (
              <span key={`history-batch-${status}`}>
                {statusLabel(status)} <b>{data?.historySummary.batchStatusCounts[status] ?? 0}</b>
              </span>
            ),
          )}
        </div>
        <div className="ai-worker-item-summary">
          <strong>{copy.itemCounts}</strong>
          {(["queued", "running", "completed", "failed"] as const).map((status) => (
            <span key={`history-item-${status}`}>
              {statusLabel(status)} <b>{data?.historySummary.itemStatusCounts[status] ?? 0}</b>
            </span>
          ))}
        </div>
        <p className="muted">
          {copy.excludedItems.replace("{count}", String(data?.historySummary.excludedItems ?? 0))}
        </p>
      </section>

      <section className="card ai-worker-section">
        <div className="ai-worker-section-heading">
          <div>
            <p className="eyebrow">BATCH LEDGER</p>
            <h2>{copy.batches}</h2>
          </div>
        </div>
        {data?.batches.length ? (
          <div className="ai-worker-batch-list">
            {data.batches.map((batch) => (
              <article className="ai-worker-batch" key={batch.batchId}>
                <div className="ai-worker-batch-main">
                  <div className="ai-worker-call-title">
                    <strong>
                      {batch.scanHost ?? (locale === "en" ? "Non-scan work" : "非扫描任务")}
                    </strong>
                    <span className={`status-badge ${statusClass(batch.status)}`}>
                      {statusLabel(batch.status)}
                    </span>
                  </div>
                  <p className="muted">
                    {batch.provider} · {batch.model}
                  </p>
                  <p className="muted">
                    {copy.scan}: {batch.scanId?.slice(0, 12) ?? "—"} · Batch:{" "}
                    {batch.batchId.slice(0, 12)}
                  </p>
                  {batch.stopReason ? (
                    <p className="muted">
                      {copy.stoppedWithReason.replace(
                        "{reason}",
                        formatAiStopReason(locale, batch.stopReason),
                      )}
                      {batch.stopRequestedAt
                        ? ` · ${copy.stoppedAt}: ${formatDate(batch.stopRequestedAt, locale)}`
                        : ""}
                    </p>
                  ) : null}
                </div>
                <div className="ai-worker-batch-counts" aria-label={copy.itemCounts}>
                  {(["queued", "running", "completed", "failed"] as const).map((status) => (
                    <span key={status}>
                      {statusLabel(status)} <b>{batch.itemCounts[status]}</b>
                    </span>
                  ))}
                  {batch.itemCounts.excludedItems ? (
                    <span>
                      {copy.excludedCount} <b>{batch.itemCounts.excludedItems}</b>
                    </span>
                  ) : null}
                  <span>
                    {copy.items} <b>{batch.itemCounts.total}</b>
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">{copy.noBatches}</p>
        )}
      </section>

      <section className="card ai-worker-section">
        <div className="ai-worker-section-heading">
          <div>
            <p className="eyebrow">PROVIDER USAGE</p>
            <h2>{copy.usage}</h2>
          </div>
          <span className="muted">{countText(data?.usageSummary.attempts, copy.total)}</span>
        </div>
        <div className="ai-worker-usage-strip">
          {(
            [
              [copy.inputTokens, data?.usageSummary.inputTokens],
              [copy.outputTokens, data?.usageSummary.outputTokens],
              [copy.totalTokens, data?.usageSummary.totalTokens],
            ] as const
          ).map(([label, value]) => (
            <div className="ai-worker-usage-value" key={label}>
              <span>{label}</span>
              <strong>
                {value === null || value === undefined ? "—" : value.toLocaleString()}
              </strong>
            </div>
          ))}
          <div className="ai-worker-usage-value">
            <span>{copy.reportedCost}</span>
            <strong>
              {data?.usageSummary.providerReportedCost.length
                ? data.usageSummary.providerReportedCost
                    .map((cost) => `${cost.amount.toFixed(4)} ${cost.currency}`)
                    .join(" · ")
                : "—"}
            </strong>
          </div>
        </div>
        <p className="muted">{copy.usageScope}</p>
        {data && data.usageSummary.costReportedAttempts === 0 ? (
          <p className="muted">{copy.costUnknown}</p>
        ) : null}
        {data && data.usageSummary.usageReportedAttempts === 0 ? (
          <p className="muted">{copy.tokenUnknown}</p>
        ) : null}
      </section>

      <section className="card ai-worker-section">
        <div className="ai-worker-section-heading">
          <div>
            <p className="eyebrow">AUDIT TRAIL</p>
            <h2>{copy.recentAttempts}</h2>
          </div>
        </div>
        {data?.recentAttempts.length ? (
          <div className="ai-worker-table-wrap">
            <table className="ai-worker-table">
              <thead>
                <tr>
                  <th>
                    {copy.provider} / {copy.model}
                  </th>
                  <th>{copy.scan}</th>
                  <th>{copy.status}</th>
                  <th>{copy.usage}</th>
                  <th>{copy.duration}</th>
                  <th>{copy.errorCode}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentAttempts.map((attempt) => (
                  <tr key={attempt.attemptId}>
                    <td>
                      <strong>{attempt.provider}</strong>
                      <small>{attempt.model}</small>
                    </td>
                    <td>
                      {attempt.scanHost ?? "—"}
                      {attempt.itemId ? (
                        <small>
                          {copy.itemAttempt
                            .replace("{item}", attempt.itemId)
                            .replace("{attempt}", String(attempt.attemptNumber))}
                        </small>
                      ) : null}
                      {attempt.itemId ? (
                        <small>
                          {copy.retryCycle.replace("{cycle}", String(attempt.retryCycle + 1))}
                        </small>
                      ) : null}
                      <small>{sendStateLabel(attempt.sendState)}</small>
                      {attempt.cancellationPending ? <small>{copy.cancelPending}</small> : null}
                    </td>
                    <td>
                      {statusLabel(attempt.status)}
                      {attempt.httpStatus ? ` · ${copy.httpStatus} ${attempt.httpStatus}` : ""}
                    </td>
                    <td>
                      {attempt.totalTokens === null
                        ? "—"
                        : `${attempt.totalTokens.toLocaleString()} tokens`}
                      {attempt.reportedCost === null
                        ? ""
                        : ` · ${attempt.reportedCost.toFixed(4)} ${attempt.currency ?? ""}`}
                    </td>
                    <td>{formatDuration(attempt.durationMs ?? attempt.elapsedMs, locale)}</td>
                    <td>{attempt.errorCode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{copy.noAttempts}</p>
        )}
      </section>
    </div>
  );
}
