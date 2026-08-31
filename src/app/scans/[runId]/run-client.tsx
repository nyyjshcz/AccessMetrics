"use client";

import { useCallback, useEffect, useState } from "react";
import AiOverlayCard from "@/components/ai-overlay-card";
import IncompleteReview from "@/components/incomplete-review";
import StatusBadge from "@/components/status-badge";

type TabKey = "overview" | "violations" | "incomplete" | "report";

function displayScore(score: any) {
  return score?.overall === null || score?.overall === undefined
    ? "无可计算数据"
    : `${score.overall} / 100`;
}

function displayedValue(value: unknown) {
  return value === null || value === undefined ? "N/A" : String(value);
}

export default function RunClient({ runId }: { runId: string }) {
  const [data, setData] = useState<any>();
  const [tab, setTab] = useState<TabKey>("overview");
  const [violations, setViolations] = useState<any[]>([]);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const fetchRun = useCallback(async () => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "读取扫描失败");
    return payload;
  }, [runId]);

  useEffect(() => {
    fetchRun()
      .then(setData)
      .catch((reason) => setError(reason.message));
  }, [fetchRun]);

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
  }, [aiBatchActive, fetchRun]);

  useEffect(() => {
    if (tab !== "violations" || violations.length) return;
    fetch(`/api/runs/${runId}/violations`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "读取自动问题失败");
        return payload;
      })
      .then((payload) => setViolations(payload.items ?? []))
      .catch((reason) => setError(reason.message));
  }, [runId, tab, violations.length]);

  async function publish() {
    const response = await fetch(`/api/runs/${runId}/publish`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error?.message ?? "发布失败");
      return;
    }
    setMessage("已发布，报告现在为只读");
    setData((current: any) => ({ ...current, run: { ...current.run, published: 1 } }));
  }

  if (error)
    return (
      <p className="error notice" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">正在读取扫描结果…</p>;

  const score = data.score;
  const incomplete = score.resultNodeCounts?.incomplete ?? 0;
  const violationCount = score.resultNodeCounts?.violation ?? 0;
  const tabs: Array<[TabKey, string]> = [
    ["overview", "概览"],
    ["violations", `自动问题 (${violationCount})`],
    ["incomplete", `incomplete 扫描结果 (${incomplete})`],
    ["report", "报告"],
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
          <StatusBadge status={data.run.status} published={data.run.published === 1} />
          <span>{data.run.published === 1 ? "发布后数据与报告均为只读" : "可继续复核和发布"}</span>
        </div>
      </header>

      <div className="tabbar run-tabbar" role="tablist" aria-label="扫描结果内容">
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
        {tab === "overview" ? <Overview score={score} data={data} /> : null}
        {tab === "violations" ? <ViolationList items={violations} /> : null}
        {tab === "incomplete" ? (
          <>
            <IncompleteReview
              runId={runId}
              refreshKey={reviewRefreshKey}
              onReviewChange={refreshAfterReviewChange}
            />
            <AiOverlayCard
              runId={runId}
              pages={data.pages ?? []}
              readOnly={data.run.published === 1}
              onBatchChange={refreshAfterReviewChange}
            />
          </>
        ) : null}
        {tab === "report" ? <Report data={data} runId={runId} publish={publish} /> : null}
      </div>

      {message ? (
        <p className="notice run-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function Overview({ score, data }: any) {
  const rawScore = data.rawScore ?? score;
  const aiBatchActive = data.ai?.batch?.status === "queued" || data.ai?.batch?.status === "running";
  const metricRows = [
    ["覆盖页面", score.pageCount ?? 0, "本次成功写入结果的页面"],
    ["自动问题", score.resultNodeCounts?.violation ?? 0, "axe 可自动判定的节点"],
    ["需进一步判断", score.resultNodeCounts?.incomplete ?? 0, "不会被直接当作自动问题"],
  ];
  const principles = [
    ["可感知", "P", score.perceivable],
    ["可操作", "O", score.operable],
    ["易理解", "U", score.understandable],
    ["兼容性", "R", score.robust],
  ];

  return (
    <div className="run-overview">
      <section className="score-surface" aria-label="评分摘要">
        <div>
          <p className="section-kicker">EFFECTIVE SCORE</p>
          <strong>{displayScore(score)}</strong>
          <p>
            复核后评分。它会纳入已经完成的人工或 AI 结论；原始 axe 结果始终保留，可在报告中核对。
          </p>
        </div>
        <dl className="score-comparison">
          <div>
            <dt>原始评分</dt>
            <dd>{displayScore(rawScore)}</dd>
          </div>
          <div>
            <dt>复核后评分</dt>
            <dd>{displayScore(score)}</dd>
          </div>
        </dl>
      </section>

      {aiBatchActive ? (
        <p className="notice">AI 正在处理需进一步判断的项目；完成后本页会自动刷新复核后评分。</p>
      ) : null}

      <section className="run-metric-grid" aria-label="扫描摘要">
        {metricRows.map(([label, value, hint]) => (
          <article key={String(label)}>
            <span>{label}</span>
            <strong>{String(value)}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </section>

      <section className="principle-score-section" aria-labelledby="principle-score-heading">
        <div className="section-heading section-heading-spacious">
          <div>
            <p className="section-kicker">WCAG PRINCIPLES</p>
            <h2 id="principle-score-heading">四项原则评分</h2>
          </div>
          <p className="muted">评分用于定位相对薄弱的维度；它不是完整人工审计或官方合规认证。</p>
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
        <strong>建议阅读顺序</strong>
        <p>
          先处理自动问题，再对需要进一步判断的项目做人工或 AI 复核，最后在“报告”中查看可发布版本。
        </p>
      </aside>

      {data.run.published === 1 ? (
        <p className="notice">该报告已发布，扫描数据和复核结论均为只读。</p>
      ) : null}
    </div>
  );
}

function ViolationList({ items }: { items: any[] }) {
  if (!items.length)
    return (
      <div className="empty-state app-empty-state">
        <strong>没有自动问题</strong>
        <p>本次扫描没有 axe 可自动判定的 violation 节点。</p>
      </div>
    );

  return (
    <section className="violation-list">
      <div className="section-heading section-heading-spacious">
        <div>
          <p className="section-kicker">AUTOMATIC FINDINGS</p>
          <h2>{items.length} 个自动问题</h2>
        </div>
        <p className="muted">这些项目由 axe 自动判定；打开单条即可核对页面、目标元素和规则说明。</p>
      </div>
      {items.map((item) => (
        <article className="violation-card" key={item.id}>
          <div className="violation-card-heading">
            <div>
              <p className="rule-id">{item.rule.id}</p>
              <h3>{item.rule.description}</h3>
            </div>
            {item.impact ? (
              <span className={`impact-tag impact-${item.impact}`}>{item.impact}</span>
            ) : null}
          </div>
          <dl className="finding-details">
            <div>
              <dt>问题页面</dt>
              <dd>
                <a href={item.page.url} target="_blank" rel="noreferrer">
                  {item.page.title || item.page.url}
                </a>
              </dd>
            </div>
            <div>
              <dt>axe 提示</dt>
              <dd>{item.failureSummary || "未提供 failureSummary"}</dd>
            </div>
            <div>
              <dt>目标元素</dt>
              <dd>
                <code>{JSON.stringify(item.target)}</code>
              </dd>
            </div>
          </dl>
          <a className="text-link" href={item.rule.helpUrl} target="_blank" rel="noreferrer">
            查看规则说明 <span aria-hidden="true">↗</span>
          </a>
        </article>
      ))}
    </section>
  );
}

function Report({ data, runId, publish }: any) {
  const score = data.score;
  const counts = score.resultNodeCounts ?? {};
  const published = data.run.published === 1;
  const pages = data.pages ?? [];
  const reportMetrics = [
    ["自动通过", counts.pass ?? 0, "pass 节点"],
    ["自动问题", counts.violation ?? 0, "violation 节点"],
    ["需进一步判断", counts.incomplete ?? 0, "incomplete 节点"],
    ["不适用", counts.inapplicable ?? 0, "inapplicable 节点"],
  ];

  return (
    <section className="report-preview">
      <div className="report-preview-hero">
        <div>
          <p className="section-kicker">REPORT PREVIEW</p>
          <h2>一份面向评审者的可读报告</h2>
          <p>
            结果先展示评分、页面覆盖和优先整改项；详细节点证据按需展开，不再用冗长表格淹没结论。
          </p>
        </div>
        <div className="report-preview-score">
          <span>当前评分</span>
          <strong>{displayScore(score)}</strong>
        </div>
      </div>

      <section className="report-metric-grid" aria-label="报告节点统计">
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
            <h3 id="report-coverage-heading">页面覆盖（{pages.length} 页）</h3>
          </div>
          <p className="muted">页面异常会明确呈现，不会默认为“扫描成功”。</p>
        </div>
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
      </section>

      {published ? (
        <section className="published-report-actions">
          <div>
            <p className="section-kicker">PUBLISHED</p>
            <h3>报告已发布并锁定</h3>
            <p>管理员和报告访客可以下载同一份只读输出。</p>
          </div>
          <div className="report-action-links">
            <a
              className="button-link button-link-compact"
              href={`/api/reports/${runId}/html`}
              target="_blank"
              rel="noreferrer"
            >
              打开 HTML
            </a>
            <a className="secondary-link" href={`/api/reports/${runId}/pdf`}>
              下载 PDF
            </a>
            <a className="secondary-link" href={`/api/reports/${runId}/json`}>
              下载 JSON
            </a>
          </div>
        </section>
      ) : (
        <section className="publish-callout">
          <div>
            <p className="section-kicker">READY TO SHARE</p>
            <h3>确认后再发布</h3>
            <p>发布会锁定扫描及其报告内容，并开放给持有访客密钥的评审者只读查看。</p>
          </div>
          {data.run.status.startsWith("completed") ? (
            <button type="button" onClick={publish}>
              生成并发布报告
            </button>
          ) : null}
        </section>
      )}
    </section>
  );
}
