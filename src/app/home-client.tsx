"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";
import { getMessages, type Locale } from "@/lib/i18n";

type HomeClientProps = {
  view: "active" | "published";
  canManagePublished?: boolean;
  locale?: Locale;
};

type ScanListRow = {
  run_id: string | null;
  run_status: string | null;
  published: number | null;
  job_id: string;
  job_status: string;
  name: string;
  origin: string;
};

const deletableStatuses = new Set(["completed", "failed", "cancelled"]);

export default function HomeClient({ view, canManagePublished = false, locale = "zh-CN" }: HomeClientProps) {
  const localized = getMessages(locale);
  const copy = localized.home;
  const dimensions = localized.homeDimensions;
  const principles = copy.principles.map((item, index) => [item[0], ["P", "O", "U", "R"][index], item[1]] as const);
  const isPublishedView = view === "published";
  const [runs, setRuns] = useState<ScanListRow[]>([]);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [withdrawingRunId, setWithdrawingRunId] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    const response = await fetch(`/api/scans?view=${view}`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getMessages(locale).home.readFailed);
    return (payload?.runs ?? []) as ScanListRow[];
  }, [locale, view]);

  const load = useCallback(async () => {
    setRuns(await fetchRuns());
  }, [fetchRuns]);

  useEffect(() => {
    let cancelled = false;
    void fetchRuns()
      .then((nextRuns) => {
        if (!cancelled) setRuns(nextRuns);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchRuns]);

  async function deleteTask(row: ScanListRow) {
    const confirmed = window.confirm(copy.deleteConfirm.replace("{name}", row.name));
    if (!confirmed) return;

    setDeleteError("");
    setDeletingJobId(row.job_id);
    try {
      const response = await fetch(`/api/scans/${row.job_id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? copy.deleteFailed);
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : copy.deleteFailed);
    } finally {
      setDeletingJobId(null);
    }
  }

  async function withdrawReport(row: ScanListRow) {
    if (!row.run_id) return;
    const confirmed = window.confirm(
      copy.withdrawConfirm.replace("{name}", row.name),
    );
    if (!confirmed) return;

    setDeleteError("");
    setWithdrawingRunId(row.run_id);
    try {
      const response = await fetch(`/api/runs/${row.run_id}/publish`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? copy.withdrawFailed);
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : copy.withdrawFailed);
    } finally {
      setWithdrawingRunId(null);
    }
  }

  const heroTitle = isPublishedView ? copy.publishedTitle : copy.activeTitle;

  return (
    <>
      <section className={`home-hero ${isPublishedView ? "home-hero-reports" : ""}`}>
        <div className="home-hero-copy">
          <p className="eyebrow">
            {isPublishedView ? copy.reportLibrary : copy.workbench}
          </p>
          <h1>{heroTitle}</h1>
          <p className="home-hero-lede">
            {isPublishedView
              ? copy.publishedLede : copy.activeLede}
          </p>
          {!isPublishedView ? (
            <div className="hero-actions">
              <Link className="button-link" href="/scans/new">
                {copy.newScan}
              </Link>
              <Link className="text-link" href="/reports">
                {copy.viewReports} <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : null}
        </div>
        <aside className="home-method" aria-label={isPublishedView ? copy.readMethod : copy.assessMethod}>
          {isPublishedView ? (
            <>
            <p className="method-label">{copy.readMethod}</p>
              <ol className="method-list">
                <li>
                  <span>01</span>
                  <strong>{copy.readOrder[0]}</strong>
                </li>
                <li>
                  <span>02</span>
                  <strong>{copy.readOrder[1]}</strong>
                </li>
                <li>
                  <span>03</span>
                  <strong>{copy.readOrder[2]}</strong>
                </li>
              </ol>
            </>
          ) : (
            <>
            <p className="method-label">{copy.assessMethod}</p>
              <ol className="method-list">
                <li>
                  <span>01</span>
                  <strong>{copy.assessPath[0]}</strong>
                </li>
                <li>
                  <span>02</span>
                  <strong>{copy.assessPath[1]}</strong>
                </li>
                <li>
                  <span>03</span>
                  <strong>{copy.assessPath[2]}</strong>
                </li>
              </ol>
            </>
          )}
        </aside>
      </section>

      <section className="content-section">
        <div className="section-heading section-heading-spacious">
          <div>
            <p className="section-kicker">
              {isPublishedView ? copy.publishedOutput : copy.currentWork}
            </p>
            <h2>{isPublishedView ? copy.reportsTitle : copy.activeTasksTitle}</h2>
            <p className="muted">
              {isPublishedView
                ? copy.readOnly : copy.activeDesc}
            </p>
          </div>
          {!isPublishedView ? (
            <Link className="text-link" href="/reports">
              {copy.openLibrary} <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>

        {deleteError ? (
          <p className="error notice" role="alert">
            {deleteError}
          </p>
        ) : null}

        {runs.length === 0 ? (
          <div className="empty-state app-empty-state">
            <strong>{isPublishedView ? copy.noReports : copy.noTasks}</strong>
            <p>
              {isPublishedView
                ? copy.noReportsBody : copy.noTasksBody}
            </p>
            {!isPublishedView ? (
              <Link className="button-link button-link-compact" href="/scans/new">
                {copy.newScan}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="run-list">
            {runs.map((row) => {
              const status = row.run_status ?? row.job_status;
              const deletable =
                view === "active" && row.published !== 1 && deletableStatuses.has(row.job_status);
              const destination =
                isPublishedView && !canManagePublished && row.run_id
                  ? (`/api/reports/${row.run_id}/html` as `/api/reports/${string}/html`)
                  : status === "completed" || status === "completed_with_errors"
                    ? (`/scans/${row.run_id ?? row.job_id}` as `/scans/${string}`)
                    : (`/scans/jobs/${row.job_id}` as `/scans/jobs/${string}`);

              return (
                <article className="run-row" key={row.run_id ?? row.job_id}>
                  <Link className="run-row-link" href={destination}>
                    <div className="run-row-info">
                      <strong>{row.name}</strong>
                      <span className="muted">{row.origin}</span>
                    </div>
                    <span className="run-row-open" aria-hidden="true">
                      {copy.view} <span>→</span>
                    </span>
                  </Link>
                  <div className="run-row-meta">
                    <StatusBadge status={status} published={row.published === 1} locale={locale} />
                    {deletable ? (
                      <button
                        type="button"
                        className="danger-button compact-button"
                        disabled={deletingJobId !== null}
                        onClick={() => void deleteTask(row)}
                      >
                        {deletingJobId === row.job_id ? copy.deleting : copy.delete}
                      </button>
                    ) : null}
                    {isPublishedView && canManagePublished && row.run_id ? (
                      <button
                        type="button"
                        className="danger-button compact-button"
                        disabled={withdrawingRunId !== null}
                        onClick={() => void withdrawReport(row)}
                      >
                        {withdrawingRunId === row.run_id ? copy.withdrawing : copy.withdraw}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {!isPublishedView ? (
        <section className="principle-section" aria-labelledby="principle-heading">
          <div className="section-heading section-heading-spacious">
            <div>
              <p className="section-kicker">WCAG PRINCIPLES</p>
              <h2 id="principle-heading">{dimensions.title}</h2>
            </div>
            <p className="muted principle-summary">
              {dimensions.summary}
            </p>
          </div>
          <div className="principle-overview">
            {principles.map(([name, initials, description]) => (
              <article key={name}>
                <span aria-hidden="true">{initials}</span>
                <div>
                  <h3>{name}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
