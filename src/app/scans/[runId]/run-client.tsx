"use client";

import { useCallback, useEffect, useState } from "react";
import AiOverlayCard from "@/components/ai-overlay-card";
import IncompleteReview from "@/components/incomplete-review";
import StatusBadge from "@/components/status-badge";
import type { Locale } from "@/lib/i18n";
import { getRuleLocalization } from "@/lib/localization";

type TabKey = "overview" | "violations" | "incomplete" | "report";

function displayScore(score: any, en = false) {
  return score?.overall === null || score?.overall === undefined
    ? en
      ? "No calculable data"
      : "无可计算数据"
    : `${score.overall} / 100`;
}

function displayedValue(value: unknown) {
  return value === null || value === undefined ? "N/A" : String(value);
}

export default function RunClient({ runId, locale = "zh-CN" }: { runId: string; locale?: Locale }) {
  const en = locale === "en";
  const [data, setData] = useState<any>();
  const [tab, setTab] = useState<TabKey>("overview");
  const [violations, setViolations] = useState<any[]>([]);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const fetchRun = useCallback(async () => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error?.message ?? (en ? "Failed to load scan" : "读取扫描失败"));
    return payload;
  }, [en, runId]);

  useEffect(() => {
    fetchRun()
      .then(setData)
      .catch((reason) => setError(reason.message));
  }, [en, fetchRun]);

  const aiBatchActive =
    data?.ai?.batch?.status === "queued" || data?.ai?.batch?.status === "running";

  useEffect(() => {
    if (!aiBatchActive) return;
    const timer = window.setInterval(() => {
      fetchRun()
        .then(setData)
        .catch((reason) => setError(reason.message));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [aiBatchActive, en, fetchRun]);

  useEffect(() => {
    if (tab !== "violations" || violations.length) return;
    fetch(`/api/runs/${runId}/violations`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error?.message ??
              (en ? "Failed to load automatic findings" : "读取自动问题失败"),
          );
        return payload;
      })
      .then((payload) => setViolations(payload.items ?? []))
      .catch((reason) => setError(reason.message));
  }, [en, runId, tab, violations.length]);

  async function publish() {
    const response = await fetch(`/api/runs/${runId}/publish`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error?.message ?? (en ? "Failed to publish report" : "发布失败"));
      return;
    }
    setMessage(en ? "Published; the report is now read-only." : "已发布，报告现在为只读");
    setData((current: any) => ({ ...current, run: { ...current.run, published: 1 } }));
  }

  async function withdrawPublish() {
    if (
      !window.confirm(
        en
          ? "Withdrawing publication hides the report from visitors and allows review and republishing. Withdraw publication?"
          : "撤回发布后，报告将不再对访客可见，并可继续复核和重新发布。确定撤回吗？",
      )
    )
      return;
    const response = await fetch(`/api/runs/${runId}/publish`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error?.message ?? (en ? "Failed to withdraw publication" : "撤回发布失败"));
      return;
    }
    setData((current: any) => ({
      ...current,
      run: { ...current.run, published: 0, published_at: null },
    }));
    setMessage(
      en
        ? "Publication withdrawn. The report can be reviewed and published again."
        : "已撤回发布。报告恢复为可复核状态，可再次发布。",
    );
  }

  if (error)
    return (
      <p className="error notice" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">{en ? "Loading scan results…" : "正在读取扫描结果…"}</p>;

  const score = data.score;
  const incomplete = score.resultNodeCounts?.incomplete ?? 0;
  const violationCount = score.resultNodeCounts?.violation ?? 0;
  const tabs: Array<[TabKey, string]> = [
    ["overview", en ? "Overview" : "概览"],
    ["violations", en ? `Automatic findings (${violationCount})` : `自动问题 (${violationCount})`],
    [
      "incomplete",
      en ? `Raw incomplete inventory (${incomplete})` : `原始 incomplete 清单 (${incomplete})`,
    ],
    ["report", en ? "Report" : "报告"],
  ];
  const refreshAfterReviewChange = () => {
    setReviewRefreshKey((value) => value + 1);
    fetchRun()
      .then(setData)
      .catch((reason) => setError(reason.message));
  };

  return (
    <section className="run-page">
      <header className="run-header">
        <div className="run-header-copy">
          <p className="eyebrow">ASSESSMENT RESULT</p>
          <h1>{data.run.name}</h1>
          <p className="run-origin">{data.run.origin}</p>
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
                ? "Data and report are read-only after publication"
                : "发布后数据与报告均为只读"
              : en
                ? "Review and publication remain available"
                : "可继续复核和发布"}
          </span>
        </div>
      </header>

      <div
        className="tabbar run-tabbar"
        role="tablist"
        aria-label={en ? "Scan result content" : "扫描结果内容"}
      >
        {tabs.map(([key, label]) => (
          <button
            type="button"
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : "secondary"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="run-content">
        {tab === "overview" ? <Overview score={score} data={data} en={en} /> : null}
        {tab === "violations" ? <ViolationList items={violations} en={en} /> : null}
        {tab === "incomplete" ? (
          <>
            <IncompleteReview
              runId={runId}
              locale={locale}
              refreshKey={reviewRefreshKey}
              onReviewChange={refreshAfterReviewChange}
            />
            <AiOverlayCard
              runId={runId}
              pages={data.pages ?? []}
              locale={locale}
              readOnly={data.run.published === 1}
              onBatchChange={refreshAfterReviewChange}
            />
          </>
        ) : null}
        {tab === "report" ? (
          <Report
            data={data}
            runId={runId}
            publish={publish}
            withdrawPublish={withdrawPublish}
            en={en}
          />
        ) : null}
      </div>

      {message ? (
        <p className="notice run-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function Overview({ score, data, en = false }: any) {
  const rawScore = data.rawScore ?? score;
  const aiBatchActive = data.ai?.batch?.status === "queued" || data.ai?.batch?.status === "running";
  const metricRows = [
    [
      en ? "Pages covered" : "覆盖页面",
      score.pageCount ?? 0,
      en ? "Pages with stored results" : "本次成功写入结果的页面",
    ],
    [
      en ? "Automatic findings" : "自动问题",
      score.resultNodeCounts?.violation ?? 0,
      en ? "Nodes axe can judge automatically" : "axe 可自动判定的节点",
    ],
    [
      en ? "Raw incomplete inventory" : "原始 incomplete 清单",
      score.resultNodeCounts?.incomplete ?? 0,
      en ? "Axe could not reach a reliable conclusion" : "axe 未能可靠地下结论；不等于仍待处理",
    ],
  ];
  const principles = [
    [en ? "Perceivable" : "可感知", "P", score.perceivable],
    [en ? "Operable" : "可操作", "O", score.operable],
    [en ? "Understandable" : "易理解", "U", score.understandable],
    [en ? "Robust" : "兼容性", "R", score.robust],
  ];
  const coverage = coverageSummary(data);

  return (
    <div className="run-overview">
      <section className="score-surface" aria-label={en ? "Score summary" : "评分摘要"}>
        <div>
          <p className="section-kicker">EFFECTIVE SCORE</p>
          <strong>{displayScore(score, en)}</strong>
          <p>
            {en
              ? "Effective score. It includes completed manual or AI conclusions; original axe results remain available for verification."
              : "复核后评分。它会纳入已经完成的人工或 AI 结论；原始 axe 结果始终保留，可在报告中核对。"}
          </p>
        </div>
        <dl className="score-comparison">
          <div>
            <dt>{en ? "Original score" : "原始评分"}</dt>
            <dd>{displayScore(rawScore, en)}</dd>
          </div>
          <div>
            <dt>{en ? "Effective score" : "复核后评分"}</dt>
            <dd>{displayScore(score, en)}</dd>
          </div>
        </dl>
      </section>

      {aiBatchActive ? (
        <p className="notice">
          {en
            ? "AI is processing items without a conclusion yet; this page will refresh the effective score when it finishes."
            : "AI 正在处理尚无结论的项目；完成后本页会自动刷新复核后评分。"}
        </p>
      ) : null}

      <section className="run-metric-grid" aria-label={en ? "Scan summary" : "扫描摘要"}>
        {metricRows.map(([label, value, hint]) => (
          <article key={String(label)}>
            <span>{label}</span>
            <strong>{String(value)}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </section>

      <CoverageSummary coverage={coverage} en={en} />

      <section className="principle-score-section" aria-labelledby="principle-score-heading">
        <div className="section-heading section-heading-spacious">
          <div>
            <p className="section-kicker">WCAG PRINCIPLES</p>
            <h2 id="principle-score-heading">{en ? "Four principle scores" : "四项原则评分"}</h2>
          </div>
          <p className="muted">
            {en
              ? "Scores help locate relatively weaker dimensions; they are not a complete manual audit or official compliance certification."
              : "评分用于定位相对薄弱的维度；它不是完整人工审计或官方合规认证。"}
          </p>
        </div>
        <div className="principle-score-grid">
          {principles.map(([label, initials, value]) => (
            <article key={String(label)}>
              <span aria-hidden="true">{initials}</span>
              <div>
                <h3>{label}</h3>
                <strong>{displayedValue(value)}</strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="next-step-note">
        <strong>{en ? "Suggested reading order" : "建议阅读顺序"}</strong>
        <p>
          {en
            ? "Start with automatic findings, then review the raw incomplete inventory. Only items without a conclusion need further judgment; AI conclusions are labeled separately. Open the Report tab for the shareable version."
            : "先处理自动问题，再查看原始 incomplete 清单；其中尚无结论的项目才需要进一步判断，AI 结论会单独标明，最后在“报告”中查看可发布版本。"}
        </p>
      </aside>

      {data.run.published === 1 ? (
        <p className="notice">
          {en ? "This report is published; scan data and conclusions are read-only." : "该报告已发布，扫描数据和复核结论均为只读。"}
        </p>
      ) : null}
    </div>
  );
}

function ViolationList({ items, en = false }: { items: any[]; en?: boolean }) {
  if (!items.length)
    return (
      <div className="empty-state app-empty-state">
        <strong>{en ? "No automatic findings" : "没有自动问题"}</strong>
        <p>
          {en
            ? "This scan has no violation nodes that axe can judge automatically."
            : "本次扫描没有 axe 可自动判定的 violation 节点。"}
        </p>
      </div>
    );

  return (
    <section className="violation-list">
      <div className="section-heading section-heading-spacious">
        <div>
          <p className="section-kicker">AUTOMATIC FINDINGS</p>
          <h2>{en ? `${items.length} automatic findings` : `${items.length} 个自动问题`}</h2>
        </div>
        <p className="muted">
          {en
            ? "axe judged these items automatically; open one to verify the page, target element, and rule guidance."
            : "这些项目由 axe 自动判定；打开单条即可核对页面、目标元素和规则说明。"}
        </p>
      </div>
      {items.map((item) => (
        <article className="violation-card" key={item.id}>
          <div className="violation-card-heading">
            <div>
              <p className="rule-id">{item.rule.id}</p>
              <h3>{en ? item.rule.description : getRuleLocalization(item.rule.id).zhName}</h3>
            </div>
            {item.impact ? (
              <span className={`impact-tag impact-${item.impact}`}>{item.impact}</span>
            ) : null}
          </div>
          <dl className="finding-details">
            <div>
              <dt>{en ? "Affected page" : "问题页面"}</dt>
              <dd>
                <a href={item.page.url} target="_blank" rel="noreferrer">
                  {item.page.title || item.page.url}
                </a>
              </dd>
            </div>
            <div>
              <dt>{en ? "axe summary" : "axe 提示"}</dt>
              <dd>{item.failureSummary || (en ? "No failureSummary provided" : "未提供 failureSummary")}</dd>
            </div>
            <div>
              <dt>{en ? "Target element" : "目标元素"}</dt>
              <dd>
                <code>{JSON.stringify(item.target)}</code>
              </dd>
            </div>
          </dl>
          <a className="text-link" href={item.rule.helpUrl} target="_blank" rel="noreferrer">
            {en ? "View rule guidance" : "查看规则说明"} <span aria-hidden="true">↗</span>
          </a>
        </article>
      ))}
    </section>
  );
}

function Report({ data, runId, publish, withdrawPublish, en = false }: any) {
  const score = data.score;
  const counts = score.resultNodeCounts ?? {};
  const published = data.run.published === 1;
  const pages = data.pages ?? [];
  const coverage = coverageSummary(data);
  const reportMetrics = [
    [en ? "Automatic passes" : "自动通过", counts.pass ?? 0, en ? "pass nodes" : "通过节点"],
    [en ? "Automatic findings" : "自动问题", counts.violation ?? 0, en ? "violation nodes" : "问题节点"],
    [
      en ? "Raw incomplete inventory" : "原始 incomplete 清单",
      counts.incomplete ?? 0,
      en ? "incomplete nodes" : "incomplete 节点",
    ],
    [en ? "Not applicable" : "不适用", counts.inapplicable ?? 0, en ? "inapplicable nodes" : "不适用节点"],
  ];

  return (
    <section className="report-preview">
      <div className="report-preview-hero">
        <div>
          <p className="section-kicker">REPORT PREVIEW</p>
          <h2>{en ? "A readable report for reviewers" : "一份面向评审者的可读报告"}</h2>
          <p>
            {en
              ? "The report starts with scores, page coverage, and priority fixes. Detailed node evidence is available on demand, so it does not obscure the conclusions."
              : "结果先展示评分、页面覆盖和优先整改项；详细节点证据按需展开，不再用冗长表格淹没结论。"}
          </p>
        </div>
        <div className="report-preview-score">
          <span>{en ? "Current score" : "当前评分"}</span>
          <strong>{displayScore(score, en)}</strong>
        </div>
      </div>

      <section className="report-metric-grid" aria-label={en ? "Report node statistics" : "报告节点统计"}>
        {reportMetrics.map(([label, value, hint]) => (
          <article key={String(label)}>
            <span>{label}</span>
            <strong>{String(value)}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </section>

      <section className="report-coverage" aria-labelledby="report-coverage-heading">
        <div className="section-heading section-heading-spacious">
          <div>
            <p className="section-kicker">PAGE COVERAGE</p>
            <h3 id="report-coverage-heading">
              {en
                ? `Page coverage (${coverage.successCount} successful / ${coverage.requestedLimit} requested limit)`
                : `页面覆盖（成功 ${coverage.successCount} / 请求上限 ${coverage.requestedLimit}）`}
            </h3>
          </div>
          <p className="muted">
            {en
              ? "Page errors are shown explicitly; they are never treated as a successful scan."
              : "页面异常会明确呈现，不会默认为“扫描成功”。"}
          </p>
        </div>
        <CoverageSummary coverage={coverage} compact en={en} />
        <ul className="page-coverage-list">
          {pages.map((page: any) => (
            <li key={page.id ?? page.canonical_url}>
              <a href={page.canonical_url} target="_blank" rel="noreferrer">
                {page.title || page.canonical_url}
              </a>
              <span>
                {page.scan_status}
                {page.http_status ? ` · HTTP ${page.http_status}` : ""}
                {page.error_code ? ` · ${page.error_code}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {coverage.failures.length ? (
          <section className="coverage-failures" aria-labelledby="coverage-failures-heading">
            <h4 id="coverage-failures-heading">
              {en ? `Unsuccessful pages (${coverage.failures.length})` : `未成功页面（${coverage.failures.length}）`}
            </h4>
            <ul>
              {coverage.failures.map((page: any) => (
                <li key={page.id ?? page.canonical_url}>
                  <a href={page.canonical_url} target="_blank" rel="noreferrer">
                    {page.canonical_url}
                  </a>
                  <span>
                    {page.error_code || page.scan_status || (en ? "Incomplete" : "未完成")}
                    {page.http_status ? ` · HTTP ${page.http_status}` : ""}
                    {page.error_message ? ` · ${page.error_message}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>

      {published ? (
        <section className="published-report-actions">
          <div>
            <p className="section-kicker">PUBLISHED</p>
            <h3>{en ? "Report published and locked" : "报告已发布并锁定"}</h3>
            <p>{en ? "Admins and report visitors can download the same read-only output." : "管理员和报告访客可以下载同一份只读输出。"}</p>
          </div>
          <div className="report-action-links">
            <a
              className="button-link button-link-compact"
              href={`/api/reports/${runId}/html`}
              target="_blank"
              rel="noreferrer"
            >
              {en ? "Open HTML" : "打开 HTML"}
            </a>
            <a className="secondary-link" href={`/api/reports/${runId}/pdf`}>
              {en ? "Download PDF" : "下载 PDF"}
            </a>
            <a className="secondary-link" href={`/api/reports/${runId}/json`}>
              {en ? "Download JSON" : "下载 JSON"}
            </a>
            <button type="button" className="secondary-link" onClick={withdrawPublish}>
              {en ? "Withdraw publication" : "撤回发布"}
            </button>
          </div>
        </section>
      ) : (
        <section className="publish-callout">
          <div>
            <p className="section-kicker">READY TO SHARE</p>
            <h3>{en ? "Review before publishing" : "确认后再发布"}</h3>
            <p>{en ? "Publishing locks the scan and report contents and makes a read-only version available to reviewers with the visitor key." : "发布会锁定扫描及其报告内容，并开放给持有访客密钥的评审者只读查看。"}</p>
          </div>
          {data.run.status.startsWith("completed") ? (
            <button type="button" onClick={publish}>
              {en ? "Generate and publish report" : "生成并发布报告"}
            </button>
          ) : null}
        </section>
      )}
    </section>
  );
}

function coverageSummary(data: any) {
  const crawl = data.crawlSummary ?? {};
  const pages = data.pages ?? [];
  const successCount = pages.filter((page: any) => page.scan_status === "success").length;
  const requestedLimit = Number(crawl.requestedPageLimit ?? successCount);
  const skippedNotFoundCount = Number(crawl.skippedNotFoundCount ?? 0);
  const stopReason = crawl.stopReason ?? "unknown";
  const failures = pages.filter((page: any) => page.scan_status !== "success");
  return { successCount, requestedLimit, skippedNotFoundCount, stopReason, failures };
}

function stopReasonLabel(reason: string, en = false) {
  if (reason === "page_limit") return en ? "Page limit reached" : "达到页面上限";
  if (reason === "queue_exhausted") return en ? "No more pages in queue" : "待扫描队列已耗尽";
  if (reason === "duration_limit") return en ? "Runtime limit reached" : "达到运行时长上限";
  return reason === "unknown" ? (en ? "No stop reason recorded" : "未提供停止原因") : reason;
}

function CoverageSummary({
  coverage,
  compact = false,
  en = false,
}: {
  coverage: ReturnType<typeof coverageSummary>;
  compact?: boolean;
  en?: boolean;
}) {
  return (
    <section
      className={`coverage-summary${compact ? " coverage-summary-compact" : ""}`}
      aria-label={en ? "Page coverage summary" : "页面覆盖摘要"}
    >
      <div>
        <span>{en ? "Scan coverage" : "扫描覆盖"}</span>
        <strong>
          {en
            ? `${coverage.successCount} successful / ${coverage.requestedLimit} requested limit`
            : `成功 ${coverage.successCount} / 请求上限 ${coverage.requestedLimit}`}
        </strong>
      </div>
      <div>
        <span>{en ? "Stop reason" : "停止原因"}</span>
        <strong>{stopReasonLabel(coverage.stopReason, en)}</strong>
      </div>
      <div>
        <span>{en ? "Skipped 404/410" : "跳过的 404/410"}</span>
        <strong>{coverage.skippedNotFoundCount}</strong>
      </div>
    </section>
  );
}
