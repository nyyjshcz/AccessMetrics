"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/components/status-badge";
import type { Locale } from "@/lib/i18n";

type RunData = {
  run: { id: string; name: string; origin: string; status: string; published: number };
  pages?: Array<{
    canonical_url: string;
    scan_status: string;
    http_status: number | null;
    error_code: string | null;
    error_message?: string | null;
  }>;
  crawlSummary?: { pageLimit?: number } | null;
};

export default function RunClient({ runId, locale = "zh-CN" }: { runId: string; locale?: Locale }) {
  const en = locale === "en";
  const [data, setData] = useState<RunData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(payload?.error?.message ?? (en ? "Failed to load scan" : "读取扫描失败"));
    setData(payload as RunData);
    setError("");
  }, [en, runId]);
  // The request synchronizes this client view with the server's live scan state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void load().catch((reason) =>
      setError(
        reason instanceof Error ? reason.message : en ? "Failed to load scan" : "读取扫描失败",
      ),
    );
  }, [en, load]);
  useEffect(() => {
    if (!data || !["queued", "running", "paused"].includes(data.run.status)) return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 2000);
    return () => window.clearInterval(timer);
  }, [data, load]);
  if (error)
    return (
      <p className="error notice" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">{en ? "Loading scan…" : "正在读取扫描…"}</p>;

  const pages = data.pages ?? [];
  const successful = pages.filter(
    (page) => ["success", "succeeded"].includes(page.scan_status) && !page.error_code,
  ).length;
  const failed = pages.filter(
    (page) => !["success", "succeeded"].includes(page.scan_status) || Boolean(page.error_code),
  );
  const pending = pages.filter((page) =>
    ["queued", "running", "pending"].includes(page.scan_status),
  ).length;
  const limit = data.crawlSummary?.pageLimit ?? pages.length;
  const terminal = ["completed", "completed_with_errors", "failed", "cancelled"].includes(
    data.run.status,
  );
  return (
    <section className="run-page run-flow-page">
      <header className="run-header">
        <div className="run-header-copy">
          <p className="eyebrow">{en ? "SCAN RESULT" : "扫描结果"}</p>
          <h1>
            {terminal
              ? en
                ? "Scan task ended"
                : "扫描任务已结束"
              : en
                ? "Scan in progress"
                : "扫描正在进行"}
          </h1>
          <p className="run-origin">
            {data.run.name}
            <br />
            <span>{data.run.origin}</span>
          </p>
        </div>
        <div className="run-header-status">
          <StatusBadge
            status={data.run.status}
            published={data.run.published === 1}
            locale={locale}
          />
          <span>
            {data.run.published === 1
              ? en
                ? "Scan data and conclusions are read-only."
                : "扫描数据和复核结论均为只读。"
              : en
                ? "Review is optional."
                : "复核是可选的。"}
          </span>
        </div>
      </header>
      <div className="run-flow-steps" aria-label={en ? "Assessment flow" : "评估流程"}>
        <span className="is-current">01 {en ? "Scan" : "扫描"}</span>
        <span>02 {en ? "Optional review" : "可选复核"}</span>
        <span>03 {en ? "Full report" : "完整报告"}</span>
      </div>
      <div className="run-content">
        <section className="run-flow-summary" aria-labelledby="scan-summary-heading">
          <div className="section-heading section-heading-spacious">
            <div>
              <p className="section-kicker">{en ? "WHAT HAPPENED" : "扫描情况"}</p>
              <h2 id="scan-summary-heading">
                {terminal
                  ? en
                    ? "Review the scan before reading the report"
                    : "先确认扫描覆盖，再阅读报告"
                  : en
                    ? "The scan is still working"
                    : "扫描还在进行"}
              </h2>
            </div>
            <p className="muted">
              {terminal
                ? en
                  ? "You can review uncertain items if useful, but you do not need to finish review before opening the report."
                  : "如果需要，可以处理自动检查无法确定的项目；不处理也可以直接打开报告。"
                : en
                  ? "This page refreshes automatically while the scanner is working."
                  : "扫描进行中，本页会自动刷新。"}
            </p>
          </div>
          <div className="run-metric-grid">
            <article>
              <span>{en ? "Pages found" : "已发现页面"}</span>
              <strong>{pages.length}</strong>
              <small>{en ? `Cap: ${limit} pages` : `本次上限 ${limit} 页`}</small>
            </article>
            <article>
              <span>{en ? "Scanned successfully" : "成功扫描"}</span>
              <strong>{successful}</strong>
              <small>{en ? "Pages with saved results" : "已保存检查结果的页面"}</small>
            </article>
            <article>
              <span>{en ? "Page errors" : "页面异常"}</span>
              <strong>{failed.length}</strong>
              <small>{en ? "Open details below" : "原因见下方"}</small>
            </article>
            <article>
              <span>{en ? "Still pending" : "仍待处理"}</span>
              <strong>{pending}</strong>
              <small>{en ? "Waiting for the scanner" : "等待扫描器处理"}</small>
            </article>
          </div>
          <p className="run-coverage-note">
            {coverageNote(data, successful, limit, failed.length, en)}
          </p>
        </section>
        {failed.length ? (
          <section className="run-exceptions" aria-labelledby="scan-exceptions-heading">
            <div className="section-heading">
              <div>
                <p className="section-kicker">{en ? "PAGE EXCEPTIONS" : "页面异常"}</p>
                <h2 id="scan-exceptions-heading">
                  {en ? "Pages that did not finish" : "未成功完成的页面"}
                </h2>
              </div>
              <p className="muted">
                {en
                  ? "These pages are kept with their original reason so the coverage is clear."
                  : "这些页面会保留原始原因，避免把覆盖情况说得过于乐观。"}
              </p>
            </div>
            <ul>
              {failed.slice(0, 8).map((page) => (
                <li key={page.canonical_url}>
                  <a href={page.canonical_url}>{page.canonical_url}</a>
                  <span>
                    {page.error_code ?? page.scan_status}
                    {page.http_status ? ` · HTTP ${page.http_status}` : ""}
                  </span>
                  <small>{page.error_message ?? ""}</small>
                </li>
              ))}
            </ul>
            {failed.length > 8 ? (
              <p className="muted">
                {en
                  ? `${failed.length - 8} more page errors are available in the report.`
                  : `报告中还有 ${failed.length - 8} 个页面异常。`}
              </p>
            ) : null}
          </section>
        ) : null}
        {terminal ? <RunNextSteps runId={runId} locale={locale} status={data.run.status} /> : null}
      </div>
    </section>
  );
}

export function RunNextSteps({
  runId,
  locale,
  status,
}: {
  runId: string;
  locale: Locale;
  status: string;
}) {
  const en = locale === "en";
  const reportAvailable = status === "completed" || status === "completed_with_errors";
  if (!reportAvailable) {
    return (
      <section className="run-next-steps" aria-labelledby="next-steps-heading">
        <div className="section-heading">
          <div>
            <p className="section-kicker">{en ? "NEXT STEP" : "下一步"}</p>
            <h2 id="next-steps-heading">
              {en ? "Scan ended without a report" : "扫描结束，但没有完整报告"}
            </h2>
          </div>
          <p className="muted">
            {en
              ? "No complete report is available because the scan did not finish successfully."
              : "由于扫描未成功完成，目前没有可用的完整报告。"}
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="run-next-steps" aria-labelledby="next-steps-heading">
      <div className="section-heading">
        <div>
          <p className="section-kicker">{en ? "NEXT STEP" : "下一步"}</p>
          <h2 id="next-steps-heading">{en ? "Choose whether to review" : "选择是否复核"}</h2>
        </div>
        <p className="muted">
          {en
            ? "The full report is available now. Review only helps with items the automatic check could not settle."
            : "完整报告现在就可以查看。复核只针对自动检查无法确定的项目。"}
        </p>
      </div>
      <div className="flow-actions">
        <Link className="button-link" href={`/scans/${runId}/review` as Route}>
          {en ? "Review items (optional)" : "处理复核项目（可选）"}
        </Link>
        <Link className="secondary-link" href={`/reports/${runId}` as Route}>
          {en ? "View full report" : "查看完整报告"}
        </Link>
      </div>
    </section>
  );
}

function coverageNote(
  data: RunData,
  successful: number,
  limit: number,
  failed: number,
  en: boolean,
) {
  if (!data.pages?.length && data.run.status === "failed")
    return en ? "The task ended before any page could be scanned." : "任务在扫描页面前结束。";
  if (data.run.status === "completed" && successful >= limit)
    return en ? `The scan reached its cap of ${limit} pages.` : `本次扫描已达到 ${limit} 页上限。`;
  if (!failed && data.run.status === "completed")
    return en
      ? "There are no more pages in the discovered site scope."
      : "在已发现的站点范围内没有更多页面。";
  return en
    ? "The maximum is a cap, not a promise that the site contains that many scannable pages."
    : "最多扫描页数只是上限，不代表网站一定有这么多可扫描页面。";
}
