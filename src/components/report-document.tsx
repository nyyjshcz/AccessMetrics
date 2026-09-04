import { getAxeRuleExplanation } from "@/lib/axe-rule-explanations";
import { reportCopy, type ReportLocale } from "@/lib/report-copy";
import type { ReportModel, NodeResolution } from "@/lib/report";

type Props = { model: ReportModel; locale: ReportLocale };

/**
 * The report body only renders prepared data.  Keep actions outside this
 * component so the same document can be used by the web page and exports.
 */
export function ReportDocument({ model, locale }: Props) {
  const copy = reportCopy[locale] ?? reportCopy["zh-CN"];
  const isEnglish = locale === "en";
  const unresolved = Math.max(0, model.incompleteResolutions.unresolved);
  const reviewed = Math.max(0, model.incompleteResolutions.total - unresolved);
  const successfulPages = model.pages.filter(
    (page) => (page.scanStatus === "success" || page.scanStatus === "succeeded") && !page.errorCode,
  ).length;
  const failedPages = model.pages.filter(
    (page) =>
      (page.scanStatus !== "success" && page.scanStatus !== "succeeded") || Boolean(page.errorCode),
  );
  const issueList = model.issues.filter((issue) => issue.resultType === "violation");
  const highPriority = issueList
    .filter((issue) => issue.impact === "critical" || issue.impact === "serious")
    .reduce((sum, issue) => sum + issue.nodeCount, 0);
  const automaticIssues = issueList.reduce((sum, issue) => sum + issue.nodeCount, 0);
  const scorePrinciples = [
    [copy.principles[0], model.score.perceivable, model.resolvedScore.perceivable],
    [copy.principles[1], model.score.operable, model.resolvedScore.operable],
    [copy.principles[2], model.score.understandable, model.resolvedScore.understandable],
    [copy.principles[3], model.score.robust, model.resolvedScore.robust],
  ] as const;

  return (
    <article className="report-shell" data-report-model="ReportModel">
      <header className="report-hero">
        <div className="report-title">
          <p className="eyebrow">{copy.eyebrow}</p>
          <span className="report-kind">{copy.reportKind}</span>
          <h1>{model.site.name}</h1>
          <p className="origin">
            <a href={safeUrl(model.site.origin)}>{model.site.origin}</a>
          </p>
          <p className="report-meta">
            {copy.finished}
            {copy.labelSeparator}
            {model.run.finishedAt ?? model.run.startedAt ?? model.run.createdAt ?? copy.notRecorded}
            <span aria-hidden="true">·</span>
            {copy.generated}
            {copy.labelSeparator}
            {model.generatedAt}
            <span aria-hidden="true">·</span>
            {model.pages.length} {copy.pages}
          </p>
        </div>
        <div className="score-stamp">
          <span>{copy.score}</span>
          <strong>{displayScore(model.resolvedScore.overall)}</strong>
          <small>
            {copy.rawScore} {displayScore(model.score.overall)}
          </small>
        </div>
      </header>

      <section className="report-section" aria-labelledby="report-overview">
        <div className="section-heading">
          <div>
            <p className="section-kicker">OVERVIEW</p>
            <h2 id="report-overview">{isEnglish ? "Overview" : "概览"}</h2>
          </div>
          <p>
            {isEnglish
              ? "A quick view of this scan and its coverage."
              : "先看这次扫描检查了什么，以及有多少页面成功完成。"}
          </p>
        </div>
        <section className="score-context" aria-label={copy.scoreLabel}>
          <p>
            <strong>{copy.scoreLead}</strong>
            {copy.scoreBody}
          </p>
          <p className="muted">
            {copy.model}
            {copy.labelSeparator}
            {model.score.modelVersion}
            {copy.itemSeparator}
            {copy.nodes}
            {copy.labelSeparator}
            {model.nodeStatistics.total}
            {copy.sentenceEnd}
          </p>
        </section>
        <div className="summary-grid">
          <Metric
            label={isEnglish ? "Score after review" : "复核后评分"}
            value={displayScore(model.resolvedScore.overall)}
            detail={
              isEnglish
                ? `Original score ${displayScore(model.score.overall)}`
                : `原始评分 ${displayScore(model.score.overall)}`
            }
          />
          <Metric
            label={isEnglish ? "Pages scanned successfully" : "成功扫描页面"}
            value={`${successfulPages} / ${model.pages.length}`}
            detail={
              failedPages.length ? `${failedPages.length} ${copy.needsAttention}` : copy.allSuccess
            }
          />
          <Metric
            label={isEnglish ? "Automatically found issues" : "自动发现的问题"}
            value={String(automaticIssues)}
            detail={copy.violationNodes}
          />
          <Metric
            label={isEnglish ? "Review items" : "复核项目"}
            value={String(model.incompleteResolutions.total)}
            detail={
              isEnglish
                ? `${reviewed} reviewed · ${unresolved} needs review`
                : `已复核 ${reviewed} · 待复核 ${unresolved}`
            }
          />
        </div>
        <div className="report-section score-section">
          <div className="section-heading">
            <div>
              <p className="section-kicker">SCORE BREAKDOWN</p>
              <h3>{copy.breakdown}</h3>
            </div>
            <p>{copy.breakdownBody}</p>
          </div>
          <div className="principle-grid">
            {scorePrinciples.map(([name, raw, effective]) => (
              <Metric
                key={name}
                label={name}
                value={displayScore(effective)}
                detail={`${copy.rawScore} ${displayScore(raw)}`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="report-section" aria-labelledby="report-issues">
        <div className="section-heading">
          <div>
            <p className="section-kicker">KEY ACCESSIBILITY ISSUES</p>
            <h2 id="report-issues">{isEnglish ? "Key accessibility issues" : "主要无障碍问题"}</h2>
          </div>
          <p>
            {isEnglish
              ? `${highPriority} high-priority affected elements are included below. Open an item for its rule explanation and evidence.`
              : `下面列出 ${highPriority} 个高优先级受影响元素。展开问题可以查看规则说明和原始证据。`}
          </p>
        </div>
        <div className="issue-list">
          {issueList.length ? (
            issueList.map((issue) => <IssueCard key={issue.id} issue={issue} locale={locale} />)
          ) : (
            <div className="empty-state">
              <strong>{copy.emptyIssues}</strong>
              <p>
                {isEnglish
                  ? "See Review status for items that need a human or AI conclusion."
                  : "需要人工或 AI 判断的项目请在“复核情况”查看。"}
              </p>
            </div>
          )}
        </div>
      </section>

      <section
        className="report-section"
        aria-labelledby="report-review"
        data-review-items={model.incompleteResolutions.total}
        data-reviewed={reviewed}
        data-needs-review={unresolved}
      >
        <div className="section-heading">
          <div>
            <p className="section-kicker">REVIEW STATUS</p>
            <h2 id="report-review">{isEnglish ? "Review status" : "复核情况"}</h2>
          </div>
          <p>
            {isEnglish
              ? "Review items are the cases the automatic check could not settle on its own. A conclusion is optional and does not change the original scan evidence."
              : "复核项目是自动检查无法单独下结论的情况。复核可以跳过，原始扫描证据不会被改写。"}
          </p>
        </div>
        <div className="resolution-grid">
          <Metric
            label={isEnglish ? "Review items" : "复核项目"}
            value={String(model.incompleteResolutions.total)}
          />
          <Metric
            label={isEnglish ? "Reviewed" : "已复核"}
            value={String(reviewed)}
            detail={
              isEnglish ? "Human, AI, or uncertain conclusion" : "包含人工、AI 和暂不确定结论"
            }
          />
          <Metric
            label={isEnglish ? "Needs review" : "待复核"}
            value={String(unresolved)}
            detail={isEnglish ? "No conclusion yet" : "尚无结论"}
          />
          <Metric
            label={isEnglish ? "Human / AI conclusions" : "人工 / AI 结论"}
            value={`${sum(model.incompleteResolutions.manual)} / ${sum(model.incompleteResolutions.ai)}`}
            detail={isEnglish ? "Uncertain is included in reviewed" : "暂不确定也计入已复核"}
          />
        </div>
      </section>

      <section className="report-section" aria-labelledby="report-failed-pages">
        <div className="section-heading">
          <div>
            <p className="section-kicker">PAGE EXCEPTIONS</p>
            <h2 id="report-failed-pages">
              {isEnglish ? "Pages not successfully scanned" : "未成功扫描页面"}
            </h2>
          </div>
          <p>
            {isEnglish
              ? "These pages were discovered but did not produce a complete automatic result."
              : "这些页面已被发现，但没有成功得到完整的自动检查结果。"}
          </p>
        </div>
        {failedPages.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{copy.page}</th>
                  <th scope="col">{copy.status}</th>
                  <th scope="col">{copy.error}</th>
                  <th scope="col">{copy.http}</th>
                </tr>
              </thead>
              <tbody>
                {failedPages.map((page) => (
                  <tr key={page.canonicalUrl}>
                    <td>
                      <a href={safeUrl(page.canonicalUrl)}>{page.canonicalUrl}</a>
                    </td>
                    <td>{pageStatus(page.scanStatus, locale)}</td>
                    <td>{page.errorCode ?? "—"}</td>
                    <td>{page.httpStatus ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <strong>{copy.noExceptions}</strong>
            <p>{copy.noExceptionsBody}</p>
          </div>
        )}
      </section>

      <aside className="report-boundary" aria-labelledby="report-about">
        <strong id="report-about">{isEnglish ? "About this report" : "报告说明"}</strong>
        <p>{copy.boundaryBody}</p>
      </aside>
      <footer>
        {copy.runId}
        {copy.labelSeparator}
        {model.runId}
        {copy.footerSeparator}
        {copy.runStatus}
        {copy.labelSeparator}
        {model.run.status}
        {copy.footerSeparator}AccessCheck Lishui
      </footer>
    </article>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function IssueCard({
  issue,
  locale,
}: {
  issue: ReportModel["issues"][number];
  locale: ReportLocale;
}) {
  const copy = reportCopy[locale] ?? reportCopy["zh-CN"];
  const guidance = getAxeRuleExplanation(issue.ruleId, {
    description: issue.description,
    help: issue.help,
    helpUrl: issue.helpUrl,
  });
  const fields = guidance.matched
    ? guidance.explanation[locale === "en" ? "en" : "zh"]
    : guidance.fallback;
  const text =
    locale === "en"
      ? {
          automatic: "Automatically found",
          affectedPages: "Affected pages",
          viewAffectedPages: `View ${issue.pageCount} affected pages`,
          evidence: "Page evidence",
          page: "Open page",
        }
      : {
          automatic: "自动发现",
          affectedPages: "受影响页面",
          viewAffectedPages: `查看 ${issue.pageCount} 个受影响页面`,
          evidence: "页面证据",
          page: "打开页面",
        };
  return (
    <article className={`issue-card impact-${impactClass(issue.impact)}`}>
      <div className="issue-rail" aria-hidden="true" />
      <div className="issue-content">
        <div className="issue-header">
          <div>
            <div className="issue-tags">
              <span className="impact-badge">{impactLabel(issue.impact, locale)}</span>
              <span className="type-badge">{text.automatic}</span>
            </div>
            <h3>{issue.help || copy.unavailable}</h3>
          </div>
          <div className="node-count">
            <strong>{issue.nodeCount}</strong>
            <span>{copy.nodesUnit}</span>
          </div>
        </div>
        <div className="issue-actions">
          <a href={safeUrl(issue.helpUrl)}>{locale === "en" ? "Rule explanation" : "规则说明"}</a>
          <span>
            {issue.pageCount} {text.affectedPages.toLocaleLowerCase()}
          </span>
        </div>
        <section
          className="rule-guidance"
          aria-label={locale === "en" ? "Rule explanation" : "规则说明"}
        >
          <h4>{fields.name || copy.unavailable}</h4>
          <p>
            <span className="muted">{locale === "en" ? "Rule ID" : "规则 ID"}:</span>{" "}
            <code>{issue.ruleId}</code>
          </p>
          <dl>
            <div>
              <dt>{copy.ruleWhat}</dt>
              <dd>{fields.what || copy.unavailable}</dd>
            </div>
            <div>
              <dt>{copy.ruleWho}</dt>
              <dd>{fields.who || copy.unavailable}</dd>
            </div>
            <div>
              <dt>{copy.ruleWhy}</dt>
              <dd>{fields.why || copy.unavailable}</dd>
            </div>
          </dl>
        </section>
        <div className="rule-summary">
          <div>
            <span>{text.affectedPages}</span>
            <strong>{issue.pageCount}</strong>
          </div>
          <div>
            <span>{copy.nodes}</span>
            <strong>{issue.nodeCount}</strong>
          </div>
        </div>
        <details className="rule-page-list">
          <summary>{text.viewAffectedPages}</summary>
          <section className="rule-page-list-content" aria-label={text.evidence}>
            {issue.pages.map((page, index) => (
              <details className="rule-page-evidence" key={`${page.pageUrl}-${index}`}>
                <summary>
                  <span>{page.pageTitle || page.pageUrl || text.evidence}</span>
                  <span>
                    {page.nodeCount} {copy.nodesUnit}
                  </span>
                </summary>
                <div className="rule-page-evidence-body">
                  <a href={safeUrl(page.pageUrl)}>{text.page}</a>
                  {page.nodes.length ? (
                    <div className="evidence-list">
                      {page.nodes.map((node) => (
                        <Evidence
                          key={`${issue.id}-${page.pageUrl}-${node.ordinal}`}
                          node={node}
                          resultType={issue.resultType}
                          locale={locale}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="evidence-unavailable">{copy.noEvidence}</p>
                  )}
                </div>
              </details>
            ))}
          </section>
        </details>
      </div>
    </article>
  );
}

function Evidence({
  node,
  resultType,
  locale,
}: {
  node: ReportModel["issues"][number]["nodes"][number];
  resultType: string;
  locale: ReportLocale;
}) {
  const copy = reportCopy[locale] ?? reportCopy["zh-CN"];
  const resolution = node.resolution;
  const label =
    resolution?.source === "manual"
      ? `${locale === "en" ? "Human" : "人工"}: ${verdict(resolution, locale)}`
      : resolution?.source === "ai"
        ? `${locale === "en" ? "AI" : "AI"}: ${verdict(resolution, locale)}`
        : resultType === "incomplete"
          ? locale === "en"
            ? "Needs review"
            : "待复核"
          : locale === "en"
            ? "Automatically found"
            : "自动发现";
  return (
    <details className="node-evidence">
      <summary>
        <span>
          {copy.node}
          {node.ordinal}
        </span>
        <span>{node.pageUrl}</span>
        <span className={`resolution ${resolution?.source ?? "raw"}`}>{label}</span>
      </summary>
      <div className="node-evidence-body">
        <div className="evidence-meta">
          <a href={safeUrl(node.pageUrl)}>{copy.openPage}</a>
          <code>{json(node.target)}</code>
        </div>
        {node.failureSummary ? <p className="failure-summary">{node.failureSummary}</p> : null}
        <p className="resolution-copy">
          <strong>{copy.conclusion}</strong>
          {label}
        </p>
        <pre>{node.html || copy.notSavedHtml}</pre>
      </div>
    </details>
  );
}

function sum(counts: Record<"problem" | "not_problem" | "uncertain", number>) {
  return counts.problem + counts.not_problem + counts.uncertain;
}
function displayScore(value: number | null) {
  return value === null ? "—" : `${value} / 100`;
}
function json(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value ?? "");
  }
}
function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "#";
  } catch {
    return "#";
  }
}
function impactClass(value: string | null) {
  return value === "critical" || value === "serious" || value === "moderate" || value === "minor"
    ? value
    : "unknown";
}
function impactLabel(value: string | null, locale: ReportLocale) {
  const labels =
    locale === "en"
      ? {
          critical: "Critical",
          serious: "High priority",
          moderate: "Moderate",
          minor: "Low priority",
        }
      : { critical: "严重", serious: "高优先级", moderate: "中等优先级", minor: "低优先级" };
  return (
    labels[value as keyof typeof labels] ?? (locale === "en" ? "Impact not labeled" : "未标注影响")
  );
}
function pageStatus(value: string, locale: ReportLocale) {
  if (value === "success" || value === "succeeded") return locale === "en" ? "Success" : "成功";
  if (value === "failed") return locale === "en" ? "Failed" : "失败";
  return value;
}
function verdict(resolution: NodeResolution, locale: ReportLocale) {
  if (resolution.verdict === "problem") return locale === "en" ? "Problem" : "存在问题";
  if (resolution.verdict === "not_problem") return locale === "en" ? "Not a problem" : "不构成问题";
  return locale === "en" ? "Uncertain" : "暂不确定";
}
