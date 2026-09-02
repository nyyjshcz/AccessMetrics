"use client";

import { useCallback, useEffect, useState } from "react";
import AiOverlayCard from "@/components/ai-overlay-card";
import IncompleteReview from "@/components/incomplete-review";
import StatusBadge from "@/components/status-badge";
import type { Locale } from "@/lib/i18n";
import { getRuleLocalization } from "@/lib/localization";
import { getAxeRuleExplanation } from "@/lib/rule-summary-catalog";

type TabKey = "overview" | "violations" | "incomplete" | "report";

type ViolationRuleSummary = {
  id: string;
  description: string;
  help: string;
  helpUrl: string;
  wcag: string[];
  highestImpact: string | null;
  pageCount: number;
  nodeCount: number;
};

type ViolationRuleDetail = {
  rule: ViolationRuleSummary;
  pages: Array<{
    id: string;
    url: string;
    canonicalUrl: string;
    title: string | null;
    nodes: any[];
    highestImpact: string | null;
    nodeCount: number;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    evidenceTotal: number;
    totalPages: number;
    hasMore: boolean;
  };
};

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
  const [violationRules, setViolationRules] = useState<ViolationRuleSummary[]>([]);
  const [violationRulesLoading, setViolationRulesLoading] = useState(false);
  const [violationRulesAttempted, setViolationRulesAttempted] = useState(false);
  const [violationRulesError, setViolationRulesError] = useState("");
  const [violationRuleDetails, setViolationRuleDetails] = useState<
    Record<string, ViolationRuleDetail>
  >({});
  const [violationRuleLoading, setViolationRuleLoading] = useState<Record<string, boolean>>({});
  const [violationRuleErrors, setViolationRuleErrors] = useState<Record<string, string>>({});
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
    if (tab !== "violations" || violationRulesAttempted || violationRulesLoading) return;
    setViolationRulesAttempted(true);
    setViolationRulesLoading(true);
    setViolationRulesError("");
    fetch(`/api/runs/${runId}/violation-rules`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error?.message ?? (en ? "Failed to load site-wide rules" : "读取全站规则失败"),
          );
        return payload;
      })
      .then((payload) => setViolationRules(payload.rules ?? []))
      .catch((reason) => setViolationRulesError(reason.message))
      .finally(() => setViolationRulesLoading(false));
  }, [en, runId, tab, violationRulesAttempted, violationRulesLoading]);

  const loadViolationRuleDetails = useCallback(
    async (ruleId: string, page = 1) => {
      const cacheKey = `${ruleId}:${page}`;
      if (violationRuleDetails[cacheKey] || violationRuleLoading[cacheKey]) return;
      setViolationRuleLoading((current) => ({ ...current, [cacheKey]: true }));
      setViolationRuleErrors((current) => {
        const next = { ...current };
        delete next[cacheKey];
        return next;
      });
      try {
        const response = await fetch(
          `/api/runs/${runId}/violation-rules/${encodeURIComponent(ruleId)}?page=${page}&pageSize=50`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error?.message ?? (en ? "Failed to load evidence" : "读取证据失败"),
          );
        setViolationRuleDetails((current) => ({
          ...current,
          [cacheKey]: payload as ViolationRuleDetail,
        }));
      } catch (reason: any) {
        setViolationRuleErrors((current) => ({ ...current, [cacheKey]: reason.message }));
      } finally {
        setViolationRuleLoading((current) => ({ ...current, [cacheKey]: false }));
      }
    },
    [en, runId, violationRuleDetails, violationRuleLoading],
  );

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
      setMessage(
        payload.error?.message ?? (en ? "Failed to withdraw publication" : "撤回发布失败"),
      );
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
  const tabs: Array<[TabKey, string]> = [
    ["overview", en ? "Overview" : "概览"],
    [
      "violations",
      violationRules.length > 0
        ? en
          ? `Site-wide rules (${violationRules.length})`
          : `全站规则 (${violationRules.length})`
        : en
          ? "Site-wide rules"
          : "全站规则",
    ],
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
        {tab === "violations" ? (
          <ViolationRuleList
            items={violationRules}
            loading={violationRulesLoading}
            details={violationRuleDetails}
            detailLoading={violationRuleLoading}
            detailErrors={violationRuleErrors}
            loadDetails={loadViolationRuleDetails}
            listError={violationRulesError}
            retryList={() => setViolationRulesAttempted(false)}
            en={en}
          />
        ) : null}
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
          {en
            ? "This report is published; scan data and conclusions are read-only."
            : "该报告已发布，扫描数据和复核结论均为只读。"}
        </p>
      ) : null}
    </div>
  );
}

function ViolationRuleList({
  items,
  loading,
  details,
  detailLoading,
  detailErrors,
  loadDetails,
  listError,
  retryList,
  en = false,
}: {
  items: ViolationRuleSummary[];
  loading: boolean;
  details: Record<string, ViolationRuleDetail>;
  detailLoading: Record<string, boolean>;
  detailErrors: Record<string, string>;
  loadDetails: (ruleId: string, page?: number) => void;
  listError: string;
  retryList: () => void;
  en?: boolean;
}) {
  if (loading) return <p role="status">{en ? "Loading site-wide rules…" : "正在读取全站规则…"}</p>;
  if (listError)
    return (
      <div className="empty-state app-empty-state">
        <p className="error" role="alert">
          {listError}
        </p>
        <button type="button" className="secondary-link" onClick={retryList}>
          {en ? "Retry" : "重试"}
        </button>
      </div>
    );
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
          <p className="section-kicker">{en ? "SITE-WIDE RULES" : "全站规则"}</p>
          <h2>{en ? `${items.length} site-wide rules` : `${items.length} 条全站规则`}</h2>
        </div>
        <p className="muted">
          {en
            ? "Each rule is grouped across the scan. Expand one to load page and node evidence."
            : "每条规则已按本次扫描跨页面汇总；展开后按需读取页面和节点证据。"}
        </p>
      </div>
      {items.map((item) => {
        const ruleId = item.id;
        const rule = item;
        const explanationResult = getAxeRuleExplanation(ruleId, {
          description: rule.description ?? "",
          help: rule.help ?? "",
          helpUrl: rule.helpUrl ?? "",
        });
        const localized = explanationResult.matched
          ? explanationResult.explanation[en ? "en" : "zh"]
          : explanationResult.fallback;
        const loadedDetails = Object.entries(details)
          .filter(([key]) => key.startsWith(`${ruleId}:`))
          .sort(([a], [b]) => Number(a.split(":").pop()) - Number(b.split(":").pop()))
          .map(([, value]) => value);
        const detail = loadedDetails[0] as ViolationRuleDetail | undefined;
        const latestDetail = loadedDetails[loadedDetails.length - 1];
        const pagination = latestDetail?.pagination ?? {};
        const currentPage = Number(pagination.page ?? 1);
        const hasMore = pagination.hasMore ?? currentPage < Number(pagination.totalPages ?? 0);
        const nextPage = currentPage + 1;
        return (
          <details
            className="violation-card violation-rule-card"
            key={ruleId}
            onToggle={(event) => {
              if ((event.currentTarget as HTMLDetailsElement).open) loadDetails(ruleId, 1);
            }}
          >
            <summary className="violation-card-heading violation-rule-summary">
              <div className="violation-card-heading">
                <div>
                  <p className="rule-id">{ruleId}</p>
                  <h3>
                    {localized.name ?? (en ? rule.description : getRuleLocalization(ruleId).zhName)}
                  </h3>
                </div>
                {item.highestImpact ? (
                  <span className={`impact-tag impact-${item.highestImpact}`}>
                    {en
                      ? `Highest impact: ${item.highestImpact}`
                      : `最高 impact：${item.highestImpact}`}
                  </span>
                ) : null}
              </div>
            </summary>
            <div className="violation-rule-body">
              {localized.what || localized.who || localized.why ? (
                <dl className="rule-explanation">
                  {localized.what ? (
                    <div>
                      <dt>{en ? "What" : "是什么"}</dt>
                      <dd>{localized.what}</dd>
                    </div>
                  ) : null}
                  {localized.who ? (
                    <div>
                      <dt>{en ? "Who may be affected" : "可能影响谁"}</dt>
                      <dd>{localized.who}</dd>
                    </div>
                  ) : null}
                  {localized.why ? (
                    <div>
                      <dt>{en ? "Why it matters" : "为什么重要"}</dt>
                      <dd>{localized.why}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <dl className="finding-details rule-stats">
                <div>
                  <dt>{en ? "Affected pages" : "影响页面"}</dt>
                  <dd>{item.pageCount}</dd>
                </div>
                <div>
                  <dt>{en ? "Nodes" : "节点数"}</dt>
                  <dd>{item.nodeCount}</dd>
                </div>
              </dl>
              {detail ? (
                <p className="muted rule-evidence-count">
                  {en
                    ? `Evidence nodes available: ${detail.pagination.evidenceTotal}`
                    : `可复核证据节点：${detail.pagination.evidenceTotal}`}
                </p>
              ) : null}
              {detailLoading[`${ruleId}:1`] ? (
                <p role="status">{en ? "Loading evidence…" : "正在读取证据…"}</p>
              ) : null}
              {detailErrors[`${ruleId}:1`] ? (
                <div>
                  <p className="error" role="alert">
                    {detailErrors[`${ruleId}:1`]}
                  </p>
                  <button
                    type="button"
                    className="secondary-link"
                    onClick={() => loadDetails(ruleId, 1)}
                  >
                    {en ? "Retry" : "重试"}
                  </button>
                </div>
              ) : null}
              {detail ? <RuleEvidence details={loadedDetails} en={en} /> : null}
              {detailErrors[`${ruleId}:${nextPage}`] ? (
                <div>
                  <p className="error" role="alert">
                    {detailErrors[`${ruleId}:${nextPage}`]}
                  </p>
                  <button
                    type="button"
                    className="secondary-link"
                    onClick={() => loadDetails(ruleId, nextPage)}
                  >
                    {en ? "Retry failed page" : "重试失败页面"}
                  </button>
                </div>
              ) : null}
              {detail && hasMore && !detailErrors[`${ruleId}:${nextPage}`] ? (
                <button
                  type="button"
                  className="secondary-link"
                  onClick={() => loadDetails(ruleId, nextPage)}
                  disabled={detailLoading[`${ruleId}:${nextPage}`]}
                >
                  {detailLoading[`${ruleId}:${nextPage}`]
                    ? en
                      ? "Loading…"
                      : "加载中…"
                    : en
                      ? "Load more nodes"
                      : "加载更多节点"}
                </button>
              ) : null}
            </div>
          </details>
        );
      })}
    </section>
  );
}

function RuleEvidence({ details, en = false }: { details: any[]; en?: boolean }) {
  const detail = details[0] ?? {};
  const rule = detail.rule ?? detail;
  const pageMap = new Map<string, { page: any; nodes: any[] }>();
  for (const entry of details) {
    for (const page of entry.pages ?? []) {
      const pageKey = String(page.id ?? page.canonicalUrl ?? page.url ?? page.title ?? "unknown");
      const current = pageMap.get(pageKey) ?? { page, nodes: [] };
      const seen = new Set(
        current.nodes.map((node: any) => node.id ?? stableNodeEvidenceKey(node)),
      );
      for (const node of page.nodes ?? []) {
        const nodeKey = node.id ?? stableNodeEvidenceKey(node);
        if (!seen.has(nodeKey)) {
          current.nodes.push(node);
          seen.add(nodeKey);
        }
      }
      pageMap.set(pageKey, current);
    }
  }
  const grouped = Array.from(pageMap.values());
  return (
    <div className="rule-evidence">
      <div className="axe-rule-source">
        <p>
          <strong>{en ? "axe rule guidance" : "axe 规则说明"}</strong>
        </p>
        <p>
          {rule.description ??
            rule.help ??
            (en ? "No axe description provided" : "未提供 axe 原文")}
        </p>
        {rule.helpUrl ? (
          <a className="text-link" href={rule.helpUrl} target="_blank" rel="noreferrer">
            {en ? "Open axe guidance" : "打开 axe 规则链接"} ↗
          </a>
        ) : null}
        {rule.wcag?.length ? <p className="muted">WCAG: {rule.wcag.join(", ")}</p> : null}
      </div>
      {grouped.map(({ page, nodes }: any, index: number) => (
        <section className="rule-page-evidence" key={page?.id ?? page?.url ?? index}>
          <h4 className="rule-page-heading">
            {page ? (
              <a href={page.url ?? page.canonicalUrl} target="_blank" rel="noreferrer">
                {page.title || page.url || page.canonicalUrl}
              </a>
            ) : en ? (
              "Evidence"
            ) : (
              "证据"
            )}
            {page?.highestImpact ? (
              <span className={`impact-tag impact-${page.highestImpact}`}>
                {en
                  ? `Highest impact: ${page.highestImpact}`
                  : `最高 impact：${page.highestImpact}`}
              </span>
            ) : null}
          </h4>
          {nodes.map((node: any, nodeIndex: number) => (
            <details className="node-evidence" key={node.id ?? nodeIndex}>
              <summary>
                {en
                  ? `Node ${node.ordinal ?? nodeIndex + 1}`
                  : `节点 ${node.ordinal ?? nodeIndex + 1}`}
              </summary>
              <div className="node-evidence-body">
                <p>
                  <strong>{en ? "Selector" : "选择器"}</strong>
                </p>
                <code>{JSON.stringify(node.target ?? node.selector)}</code>
                {node.failureSummary ? (
                  <p className="failure-summary">{node.failureSummary}</p>
                ) : null}
                {(node.html ?? node.htmlSanitized) ? (
                  <pre>{node.html ?? node.htmlSanitized}</pre>
                ) : null}
                {node.any || node.all || node.none || node.checks ? (
                  <pre>
                    {JSON.stringify(
                      node.checks ?? { any: node.any, all: node.all, none: node.none },
                      null,
                      2,
                    )}
                  </pre>
                ) : null}
              </div>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

function stableNodeEvidenceKey(node: any) {
  return `${JSON.stringify(node.target ?? node.selector ?? "")}|${node.failureSummary ?? ""}|${node.ordinal ?? ""}`;
}

function dedupeNodes(nodes: any[]) {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const key = String(node.id ?? stableNodeEvidenceKey(node));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function Report({ data, runId, publish, withdrawPublish, en = false }: any) {
  const score = data.score;
  const counts = score.resultNodeCounts ?? {};
  const published = data.run.published === 1;
  const pages = data.pages ?? [];
  const coverage = coverageSummary(data);
  const reportMetrics = [
    [en ? "Automatic passes" : "自动通过", counts.pass ?? 0, en ? "pass nodes" : "通过节点"],
    [
      en ? "Automatic findings" : "自动问题",
      counts.violation ?? 0,
      en ? "violation nodes" : "问题节点",
    ],
    [
      en ? "Raw incomplete inventory" : "原始 incomplete 清单",
      counts.incomplete ?? 0,
      en ? "incomplete nodes" : "incomplete 节点",
    ],
    [
      en ? "Not applicable" : "不适用",
      counts.inapplicable ?? 0,
      en ? "inapplicable nodes" : "不适用节点",
    ],
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

      <section
        className="report-metric-grid"
        aria-label={en ? "Report node statistics" : "报告节点统计"}
      >
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
              {en
                ? `Unsuccessful pages (${coverage.failures.length})`
                : `未成功页面（${coverage.failures.length}）`}
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
            <p>
              {en
                ? "Admins and report visitors can download the same read-only output."
                : "管理员和报告访客可以下载同一份只读输出。"}
            </p>
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
            <p>
              {en
                ? "Publishing locks the scan and report contents and makes a read-only version available to reviewers with the visitor key."
                : "发布会锁定扫描及其报告内容，并开放给持有访客密钥的评审者只读查看。"}
            </p>
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
