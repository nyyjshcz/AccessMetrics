"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";
import { getMessages, type Locale } from "@/lib/i18n";

export default function JobClient({ jobId, locale = "zh-CN" }: { jobId: string; locale?: Locale }) {
  const copy = getMessages(locale).job;
  const failedMessage = copy.failed;
  const [id] = useState(jobId);
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const response = await fetch(`/api/scans/${id}`);
      const value = await response.json();
      if (!response.ok) {
        setError(value.error?.message ?? failedMessage);
        return;
      }
      setData(value);
      if (["queued", "running"].includes(value.job.status)) timer = setTimeout(load, 1500);
    };
    void load();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [failedMessage, id]);

  if (error)
    return (
      <p className="error notice" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">{copy.preparing}</p>;

  const done = ["completed", "completed_with_errors", "failed", "cancelled"].includes(
    data.job.status,
  );
  const progress = data.progress ?? {};
  const discovered = Number(progress.discovered ?? 0);
  const success = Number(progress.success ?? 0);
  const failed = Number(progress.failed ?? 0);
  const deduplicated = Number(progress.deduplicated ?? 0);
  const queued = Number(progress.queued ?? 0);
  const scanning = Number(progress.scanning ?? 0);
  let maxPages: number | null = null;
  try {
    const value = JSON.parse(data.job.options_json ?? "{}")?.maxPages;
    if (Number.isInteger(value)) maxPages = value;
  } catch {
    // The scan remains readable even if an old job has malformed options.
  }
  const terminal = success + failed + deduplicated + Number(progress.cancelled ?? 0);
  const failedBeforeDiscovery =
    done && discovered === 0 && data.job.status === "failed" && data.failure;
  const progressBase = Math.max(1, discovered);
  const currentTarget = data.currentPage?.canonical_url ?? copy.waiting;

  return (
    <section className="scan-progress-page">
      <div className="scan-progress-hero">
        <div>
          <p className="eyebrow">SCAN IN PROGRESS</p>
          <h1>{done ? copy.ended : copy.checking}</h1>
          <p className="scan-origin">{data.job.origin}</p>
        </div>
        <StatusBadge status={data.job.status} locale={locale} />
      </div>

      <section className="scan-progress-panel" aria-label={copy.progress}>
        <div className="scan-progress-context">
          <p className="section-kicker">{copy.activity}</p>
          <p>
            {failedBeforeDiscovery
              ? copy.discoveryFailureBody
              : done
                ? copy.terminalSummary
                : currentTarget}
          </p>
          {failedBeforeDiscovery ? (
            <div className="error notice" role="alert">
              <strong>{copy.discoveryFailureTitle}</strong>
              <dl>
                <dt>{copy.discoveryFailureCode}</dt>
                <dd>{String(data.failure.code).slice(0, 128)}</dd>
                <dt>{copy.discoveryFailureMessage}</dt>
                <dd>{String(data.failure.message ?? copy.discoveryFailureBody).slice(0, 1000)}</dd>
              </dl>
            </div>
          ) : null}
        </div>
        <div
          className="progress-bar scan-progress-bar"
          aria-label={copy.processed}
          aria-valuemin={0}
          aria-valuemax={progressBase}
          aria-valuenow={Math.min(terminal, progressBase)}
          role="progressbar"
        >
          <span style={{ width: `${Math.min(100, (terminal / progressBase) * 100)}%` }} />
        </div>
        <div className="scan-progress-grid">
          <div>
            <span>{copy.discovered}</span>
            <strong>{discovered}</strong>
            <small>
              {maxPages === null ? copy.pages : copy.limit.replace("{count}", String(maxPages))}
            </small>
          </div>
          <div>
            <span>{copy.success}</span>
            <strong>{success}</strong>
            <small>{copy.successNote}</small>
          </div>
          <div>
            <span>{copy.failedPages}</span>
            <strong>{failed}</strong>
            <small>{copy.failedNote}</small>
          </div>
          <div>
            <span>{copy.pending}</span>
            <strong>{queued + scanning}</strong>
            <small>
              {scanning > 0 ? copy.scanning.replace("{count}", String(scanning)) : copy.worker}
            </small>
          </div>
        </div>
        <p className="scan-progress-note">
          {copy.note}
          {deduplicated > 0 ? ` ${copy.merged.replace("{count}", String(deduplicated))}` : ""}
        </p>
        {data.run && done ? (
          <a className="button-link" href={`/scans/${data.run.id}`}>
            {copy.results}
          </a>
        ) : null}
      </section>
    </section>
  );
}
