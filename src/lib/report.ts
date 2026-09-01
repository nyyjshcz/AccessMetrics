import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { buildRunScore } from "./run-score";
import { config } from "./config";
import { loadAiOverlayForRun, type AiVerdict } from "./ai-overlay";
import {
  applyHumanPrecedence,
  loadLocalManualVerdicts,
  type ResolutionVerdict,
} from "./incomplete-resolution";

export type NodeResolutionSource = "manual" | "ai" | "raw";

/** Effective conclusion for one incomplete node: human local/ad_hoc > AI > raw incomplete. */
export type NodeResolution = {
  verdict: ResolutionVerdict | null; // null means the node is still an unresolved raw incomplete
  source: NodeResolutionSource;
};

export type IncompleteResolutionSummary = {
  total: number;
  manual: Record<ResolutionVerdict, number>;
  ai: Record<ResolutionVerdict, number>;
  unresolved: number;
};

function emptyVerdictCounts(): Record<ResolutionVerdict, number> {
  return { problem: 0, not_problem: 0, uncertain: 0 };
}

export function nodeResolution(
  nodeId: string,
  resultType: string,
  manualVerdicts: ReadonlyMap<string, ResolutionVerdict>,
  aiVerdicts: ReadonlyMap<string, AiVerdict>,
): NodeResolution | null {
  if (resultType !== "incomplete") return null;
  const manual = manualVerdicts.get(nodeId);
  if (manual) return { verdict: manual, source: "manual" };
  const ai = aiVerdicts.get(nodeId);
  if (ai) return { verdict: ai, source: "ai" };
  return { verdict: null, source: "raw" };
}

export type AuthorizedRunReportDto = {
  runId: string;
  site: { name: string; origin: string };
  run: {
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string | null;
  };
  score: ReturnType<typeof buildRunScore>;
  resolvedScore: ReturnType<typeof buildRunScore>;
  generatedAt: string;
  pages: Array<{
    canonicalUrl: string;
    scanStatus: string;
    httpStatus: number | null;
    errorCode: string | null;
    frameCoverageStatus: string | null;
  }>;
  nodeStatistics: {
    total: number;
    pass: number;
    violation: number;
    incomplete: number;
    inapplicable: number;
  };
  issues: Array<{
    id: string;
    ruleId: string;
    impact: string | null;
    resultType: string;
    help: string;
    helpUrl: string;
    nodeCount: number;
    nodes: Array<{
      ordinal: number;
      pageUrl: string;
      target: unknown;
      html: string;
      failureSummary: string | null;
      framePath: unknown;
      resolution: NodeResolution | null;
    }>;
  }>;
  incompleteResolutions: IncompleteResolutionSummary;
};

export function buildRunReportDto(runId: string): AuthorizedRunReportDto {
  const run = getDb()
    .prepare(
      "SELECT r.id,r.status,r.started_at,r.finished_at,r.created_at,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
    )
    .get(runId) as
    | {
        id: string;
        status: string;
        started_at: string | null;
        finished_at: string | null;
        created_at: string | null;
        origin: string;
        name: string;
      }
    | undefined;
  if (!run) throw new Error("run not found");
  const aiVerdicts = loadAiOverlayForRun(runId);
  const manualVerdicts = loadLocalManualVerdicts(runId);
  // The report's effective conclusion is deliberately local/ad_hoc human
  // decision first, then completed AI, then the original incomplete result.
  const effectiveVerdicts = applyHumanPrecedence(aiVerdicts, manualVerdicts);
  const score = buildRunScore(runId);
  const resolvedScore = buildRunScore(runId, { aiOverlay: effectiveVerdicts });
  const pages = getDb()
    .prepare(
      "SELECT canonical_url,scan_status,http_status,error_code,frame_coverage_status FROM pages WHERE run_id=? ORDER BY canonical_url",
    )
    .all(runId) as Array<{
    canonical_url: string;
    scan_status: string;
    http_status: number | null;
    error_code: string | null;
    frame_coverage_status: string | null;
  }>;
  const issues = getDb()
    .prepare(
      "SELECT id,rule_id,impact,result_type,help,help_url,node_count FROM rule_results WHERE run_id=? ORDER BY CASE impact WHEN 'critical' THEN 1 WHEN 'serious' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 ELSE 5 END,rule_id,result_type",
    )
    .all(runId) as Array<{
    id: string;
    rule_id: string;
    impact: string | null;
    result_type: string;
    help: string;
    help_url: string;
    node_count: number;
  }>;
  const issueNodes = new Map<
    string,
    Array<{
      ordinal: number;
      pageUrl: string;
      target: unknown;
      html: string;
      failureSummary: string | null;
      framePath: unknown;
      nodeId: string;
    }>
  >();
  const issueIds = issues.map((issue) => issue.id);
  if (issueIds.length > 0) {
    const nodeRows = getDb()
      .prepare(
        `SELECT rn.id AS node_id,rn.rule_result_id,rn.ordinal,rn.target_json,rn.html_sanitized,rn.failure_summary,rn.frame_path_json,p.canonical_url FROM result_nodes rn JOIN pages p ON p.id=(SELECT page_id FROM rule_results WHERE id=rn.rule_result_id) WHERE rn.rule_result_id IN (${issueIds.map(() => "?").join(",")}) ORDER BY rn.rule_result_id,rn.ordinal`,
      )
      .all(...issueIds) as Array<{
      rule_result_id: string;
      node_id: string;
      ordinal: number;
      target_json: string;
      html_sanitized: string;
      failure_summary: string | null;
      frame_path_json: string | null;
      canonical_url: string;
    }>;
    for (const node of nodeRows) {
      let target: unknown = node.target_json;
      let framePath: unknown = [];
      try {
        target = JSON.parse(node.target_json);
      } catch {
        // Preserve malformed legacy evidence as text instead of failing report generation.
      }
      if (node.frame_path_json) {
        try {
          framePath = JSON.parse(node.frame_path_json);
        } catch {
          framePath = [];
        }
      }
      const list = issueNodes.get(node.rule_result_id) ?? [];
      list.push({
        ordinal: node.ordinal,
        nodeId: node.node_id,
        pageUrl: node.canonical_url,
        target,
        html: node.html_sanitized,
        failureSummary: node.failure_summary,
        framePath,
      });
      issueNodes.set(node.rule_result_id, list);
    }
  }
  const nodeCounts = getDb()
    .prepare(
      `SELECT rr.result_type,SUM(rr.node_count) AS count
       FROM rule_results rr
       WHERE rr.run_id=? GROUP BY rr.result_type`,
    )
    .all(runId) as Array<{ result_type: string; count: number }>;
  const nodeStatistics = { total: 0, pass: 0, violation: 0, incomplete: 0, inapplicable: 0 };
  for (const row of nodeCounts) {
    const count = Number(row.count) || 0;
    if (row.result_type in nodeStatistics && row.result_type !== "total")
      nodeStatistics[row.result_type as keyof Omit<typeof nodeStatistics, "total">] += count;
  }
  nodeStatistics.total = Object.entries(nodeStatistics)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, count]) => sum + count, 0);
  const incompleteResolutions: IncompleteResolutionSummary = {
    total: nodeStatistics.incomplete,
    manual: emptyVerdictCounts(),
    ai: emptyVerdictCounts(),
    unresolved: 0,
  };
  for (const issue of issues) {
    if (issue.result_type !== "incomplete") continue;
    for (const node of issueNodes.get(issue.id) ?? []) {
      const resolution = nodeResolution(node.nodeId, issue.result_type, manualVerdicts, aiVerdicts);
      if (!resolution || resolution.source === "raw") incompleteResolutions.unresolved++;
      else incompleteResolutions[resolution.source][resolution.verdict!]++;
    }
  }
  return {
    runId,
    site: { name: run.name, origin: run.origin },
    run: {
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      createdAt: run.created_at,
    },
    score,
    resolvedScore,
    generatedAt: new Date().toISOString(),
    pages: pages.map((page) => ({
      canonicalUrl: page.canonical_url,
      scanStatus: page.scan_status,
      httpStatus: page.http_status,
      errorCode: page.error_code,
      frameCoverageStatus: page.frame_coverage_status,
    })),
    issues: issues.map((issue) => ({
      id: issue.id,
      ruleId: issue.rule_id,
      impact: issue.impact,
      resultType: issue.result_type,
      help: issue.help,
      helpUrl: issue.help_url,
      nodeCount: Math.max(0, Number(issue.node_count) || 0),
      nodes: (issueNodes.get(issue.id) ?? []).map((node) => ({
        ordinal: node.ordinal,
        pageUrl: node.pageUrl,
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
        framePath: node.framePath,
        resolution: nodeResolution(node.nodeId, issue.result_type, manualVerdicts, aiVerdicts),
      })),
    })),
    nodeStatistics,
    incompleteResolutions,
  };
}

export type ReportLocale = "zh-CN" | "en";

const reportCopy = {
  "zh-CN": {
    lang: "zh-CN", sentenceEnd: "。", notRecorded: "未记录", notSavedHtml: "（未保存 HTML 片段）", highPriorityTypes: "critical / serious", labelSeparator: "：", itemSeparator: "；", footerSeparator: " · ", title: "AccessCheck 无障碍报告", eyebrow: "ACCESSIBILITY AUDIT · 扫描报告", finished: "扫描完成", generated: "生成", pages: "个页面", score: "有效评分", rawScore: "原始评分", scoreLabel: "评分说明", scoreLead: "先看有效评分，再处理高优先级问题。", scoreBody: "有效评分会纳入已完成的人工与 AI 对 incomplete 的结论；判定优先级为：人工 > AI > 原始 incomplete。", model: "评分模型", nodes: "统计节点", node: "节点 #", high: "高优先级节点", automatic: "自动发现", further: "尚无结论", coverage: "页面覆盖", violationNodes: "violation 节点", incompleteNodes: "incomplete 节点", needsAttention: "个页面需关注", allSuccess: "全部页面成功", principles: ["可感知", "可操作", "易理解", "兼容性"], breakdown: "四项原则评分", breakdownBody: "原始结果与有效结论并列，便于核对 AI / 人工处理是否改变了评分。", action: "优先整改事项", actionBody: "按严重程度排列。展开单条可查看页面、元素定位、清理后的片段与当前有效结论。", emptyIssues: "没有可展示的问题项", emptyIssuesBody: "本次扫描没有 violation 或 incomplete 结果。", review: "incomplete 复核情况", reviewBody: "这些结论不会覆盖原始 axe 结果，只用于生成有效评分与整改判断。", originalIncomplete: "原始 incomplete 清单", manual: "人工已判定", ai: "AI 已判定", unresolved: "尚无结论", problem: "存在问题", notProblem: "不构成问题", uncertain: "暂不确定", remains: "仍未得出结论", exceptions: "失败或未完成页面", exceptionsBody: "没有成功完成扫描的页面会在此列出，不会被计入“成功覆盖”。", page: "页面", status: "状态", error: "结构化错误", http: "HTTP", noExceptions: "没有页面例外", noExceptionsBody: "所有已发现页面都已成功完成扫描。", boundary: "报告边界", boundaryBody: "axe-core 无法在当前页面状态下自动给出通过或问题结论的项目会标为 incomplete；这不代表项目一定存在问题。", runId: "运行 ID", runStatus: "运行状态", footer: "自动检查报告", issueAutomatic: "自动发现", issueFurther: "尚无结论", nodesUnit: "个节点", openPage: "打开问题页面", conclusion: "当前结论：", rule: "查看规则说明", evidence: "查看 {n} 条可复现证据", ruleNodes: "该规则记录 {n} 个节点", noEvidence: "本条规则没有保存节点级证据", rawIncomplete: "尚无结论（原始 incomplete）", automaticIssue: "自动发现的问题", manualPrefix: "人工确认：", aiPrefix: "AI 判断：", noConclusion: "尚无结论", critical: "严重", serious: "高优先级", moderate: "中等优先级", minor: "低优先级", unknown: "未标注影响", language: "English" },
  en: {
    lang: "en-US", sentenceEnd: ".", notRecorded: "Not recorded", notSavedHtml: "(HTML snippet not saved)", highPriorityTypes: "critical / serious", labelSeparator: ": ", itemSeparator: "; ", footerSeparator: " · ", title: "AccessCheck Accessibility Report", eyebrow: "ACCESSIBILITY AUDIT · SCAN REPORT", finished: "Completed", generated: "Generated", pages: "pages", score: "Effective score", rawScore: "Raw score", scoreLabel: "Score context", scoreLead: "Review the effective score first, then address high-priority issues.", scoreBody: "The effective score includes completed human and AI conclusions for incomplete results; precedence is human > AI > raw incomplete.", model: "Scoring model", nodes: "nodes counted", node: "Node #", high: "High-priority nodes", automatic: "Automatically found", further: "No conclusion yet", coverage: "Page coverage", violationNodes: "violation nodes", incompleteNodes: "incomplete nodes", needsAttention: "pages need attention", allSuccess: "All pages succeeded", principles: ["Perceivable", "Operable", "Understandable", "Robust"], breakdown: "Four-principle score", breakdownBody: "Raw results and effective conclusions are shown together so AI and human review changes can be checked.", action: "Priority remediation", actionBody: "Sorted by impact. Expand an item to inspect the page, target, sanitized snippet, and current conclusion.", emptyIssues: "No issues to display", emptyIssuesBody: "This scan has no violation or incomplete results.", review: "Incomplete review status", reviewBody: "These conclusions do not replace raw axe results; they only inform the effective score and remediation decisions.", originalIncomplete: "Raw incomplete inventory", manual: "Human decisions", ai: "AI decisions", unresolved: "No conclusion yet", problem: "Problem", notProblem: "Not a problem", uncertain: "Uncertain", remains: "No conclusion yet", exceptions: "Failed or incomplete pages", exceptionsBody: "Pages that did not complete successfully are listed here and are excluded from successful coverage.", page: "Page", status: "Status", error: "Structured error", http: "HTTP", noExceptions: "No page exceptions", noExceptionsBody: "All discovered pages completed successfully.", boundary: "Report boundary", boundaryBody: "This report reflects web accessibility results that axe-core can determine automatically. It is not a complete manual audit, official WCAG certification, or a percentage of WCAG conformance. Items that axe-core cannot classify as passing or problematic in the current page state are marked incomplete; this does not mean an issue is confirmed.", runId: "Run ID", runStatus: "Run status", footer: "Automated accessibility report", issueAutomatic: "Automatically found", issueFurther: "No conclusion yet", nodesUnit: "nodes", openPage: "Open affected page", conclusion: "Current conclusion:", rule: "View rule guidance", evidence: "View {n} reproducible evidence items", ruleNodes: "This rule records {n} nodes", noEvidence: "No node-level evidence was saved for this rule", rawIncomplete: "No conclusion yet (raw incomplete)", automaticIssue: "Automatically detected issue", manualPrefix: "Human decision: ", aiPrefix: "AI decision: ", noConclusion: "No conclusion yet", critical: "Critical", serious: "High priority", moderate: "Moderate priority", minor: "Low priority", unknown: "Impact not labeled", language: "中文" },
} as const;

export function renderRunReportHtml(dto: AuthorizedRunReportDto, locale: ReportLocale = "zh-CN"): string {
  const copy = reportCopy[locale] ?? reportCopy["zh-CN"];
  const score = dto.score;
  const resolvedScore = dto.resolvedScore;
  const relevantIssues = dto.issues.filter(
    (issue) => issue.resultType === "violation" || issue.resultType === "incomplete",
  );
  const automaticNodeCount = relevantIssues
    .filter((issue) => issue.resultType === "violation")
    .reduce((total, issue) => total + issue.nodeCount, 0);
  // The summary card is about items still lacking a conclusion, not the raw
  // incomplete population. The full raw total is shown in REVIEW STATUS.
  const incompleteNodeCount = dto.incompleteResolutions.unresolved;
  const successfulPages = dto.pages.filter(
    (page) => page.scanStatus === "success" && !page.errorCode,
  ).length;
  const attentionPages = dto.pages.length - successfulPages;
  const highPriorityCount = relevantIssues
    .filter((issue) => issue.impact === "critical" || issue.impact === "serious")
    .reduce((total, issue) => total + issue.nodeCount, 0);
  const issueCardsRaw = relevantIssues.map((issue) => renderIssueCard(issue, copy)).join("");
  const issueCards = issueCardsRaw;
  const failedRowsRaw = dto.pages
    .filter((page) => page.scanStatus !== "success" || page.errorCode)
    .map(
      (page) =>
        `<tr><td><a href="${safeReportUrl(page.canonicalUrl)}">${escapeHtml(page.canonicalUrl)}</a></td><td>${escapeHtml(pageStatusLabel(page.scanStatus, copy))}</td><td>${escapeHtml(page.errorCode ?? "—")}</td><td>${page.httpStatus ?? "—"}</td></tr>`,
    )
    .join("");
  const failedRows = failedRowsRaw;
  const principleRows = [
    [copy.principles[0], score.perceivable, resolvedScore.perceivable],
    [copy.principles[1], score.operable, resolvedScore.operable],
    [copy.principles[2], score.understandable, resolvedScore.understandable],
    [copy.principles[3], score.robust, resolvedScore.robust],
  ] as const;
  const emptyIssues = `<div class="empty-state"><strong>${copy.emptyIssues}</strong><p>${copy.emptyIssuesBody}</p></div>`;
  const emptyExceptions = `<div class="empty-state"><strong>${copy.noExceptions}</strong><p>${copy.noExceptionsBody}</p></div>`;
  return `<!doctype html><html lang="${copy.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${copy.title} - ${escapeHtml(dto.site.name)}</title><style>${reportStyles()}</style></head><body><main class="report-shell"><header class="report-hero"><div class="report-title"><p class="eyebrow">${copy.eyebrow}</p><h1>${escapeHtml(dto.site.name)}</h1><p class="origin"><a href="${safeReportUrl(dto.site.origin)}">${escapeHtml(dto.site.origin)}</a></p><p class="report-meta">${copy.finished}${copy.labelSeparator}${escapeHtml(dto.run.finishedAt ?? dto.run.startedAt ?? dto.run.createdAt ?? copy.notRecorded)}<span aria-hidden="true">·</span>${copy.generated}${copy.labelSeparator}${escapeHtml(dto.generatedAt)}<span aria-hidden="true">·</span>${dto.pages.length} ${copy.pages}</p></div><div class="score-stamp"><span>${copy.score}</span><strong>${displayScore(resolvedScore.overall)}</strong><small>${copy.rawScore} ${displayScore(score.overall)}</small></div></header><section class="score-context" aria-label="${copy.scoreLabel}"><p><strong>${copy.scoreLead}</strong>${copy.scoreBody}</p><p class="muted">${copy.model}${copy.labelSeparator}${escapeHtml(score.modelVersion)}${copy.itemSeparator}${copy.nodes}${copy.labelSeparator}${dto.nodeStatistics.total}${copy.sentenceEnd}</p></section><section class="summary-grid" aria-label="${copy.scoreLabel}"><article><span>${copy.high}</span><strong>${highPriorityCount}</strong><small>${copy.highPriorityTypes}</small></article><article><span>${copy.automatic}</span><strong>${automaticNodeCount}</strong><small>${copy.violationNodes}</small></article><article><span>${copy.further}</span><strong>${incompleteNodeCount}</strong><small>${copy.incompleteNodes}</small></article><article><span>${copy.coverage}</span><strong>${successfulPages} / ${dto.pages.length}</strong><small>${attentionPages ? `${attentionPages} ${copy.needsAttention}` : copy.allSuccess}</small></article></section><section class="report-section score-section"><div class="section-heading"><div><p class="section-kicker">SCORE BREAKDOWN</p><h2>${copy.breakdown}</h2></div><p>${copy.breakdownBody}</p></div><div class="principle-grid">${principleRows.map(([name, raw, effective]) => `<article><span>${escapeHtml(name)}</span><strong>${displayScore(effective)}</strong><small>${copy.rawScore} ${displayScore(raw)}</small></article>`).join("")}</div></section><section class="report-section"><div class="section-heading"><div><p class="section-kicker">ACTION QUEUE</p><h2>${copy.action}</h2></div><p>${copy.actionBody}</p></div><div class="issue-list">${issueCards || emptyIssues}</div></section><section class="report-section"><div class="section-heading"><div><p class="section-kicker">REVIEW STATUS</p><h2>${copy.review}</h2></div><p>${copy.reviewBody}</p></div><div class="resolution-grid"><article><span>${copy.originalIncomplete}</span><strong>${dto.incompleteResolutions.total}</strong></article><article><span>${copy.manual}</span><strong>${sumVerdicts(dto.incompleteResolutions.manual)}</strong><small>${copy.problem} ${dto.incompleteResolutions.manual.problem} · ${copy.notProblem} ${dto.incompleteResolutions.manual.not_problem} · ${copy.uncertain} ${dto.incompleteResolutions.manual.uncertain}</small></article><article><span>${copy.ai}</span><strong>${sumVerdicts(dto.incompleteResolutions.ai)}</strong><small>${copy.problem} ${dto.incompleteResolutions.ai.problem} · ${copy.notProblem} ${dto.incompleteResolutions.ai.not_problem} · ${copy.uncertain} ${dto.incompleteResolutions.ai.uncertain}</small></article><article><span>${copy.further}</span><strong>${dto.incompleteResolutions.unresolved}</strong><small>${copy.remains}</small></article></div></section><section class="report-section"><div class="section-heading"><div><p class="section-kicker">PAGE EXCEPTIONS</p><h2>${copy.exceptions}</h2></div><p>${copy.exceptionsBody}</p></div>${failedRows ? `<div class="table-scroll"><table><thead><tr><th scope="col">${copy.page}</th><th scope="col">${copy.status}</th><th scope="col">${copy.error}</th><th scope="col">HTTP</th></tr></thead><tbody>${failedRows}</tbody></table></div>` : emptyExceptions}</section><aside class="report-boundary"><strong>${copy.boundary}</strong><p>${copy.boundaryBody}</p></aside><footer>${copy.runId}${copy.labelSeparator}${escapeHtml(dto.runId)}${copy.footerSeparator}${copy.runStatus}${copy.labelSeparator}${escapeHtml(dto.run.status)}${copy.footerSeparator} AccessCheck Lishui</footer></main></body></html>`;
}

function renderIssueCard(issue: AuthorizedRunReportDto["issues"][number], copy: (typeof reportCopy)[ReportLocale]) {
  const impact = normalizeImpact(issue.impact, copy);
  const issueType = issue.resultType === "violation" ? copy.issueAutomatic : copy.originalIncomplete;
  const evidence = issue.nodes
    .map((node) => {
      const resolution = resolutionText(node.resolution, issue.resultType, copy);
      return `<details class="node-evidence"><summary><span>${copy.node}${node.ordinal}</span><span>${escapeHtml(shortUrl(node.pageUrl))}</span><span class="resolution ${resolution.className}">${escapeHtml(resolution.label)}</span></summary><div class="node-evidence-body"><div class="evidence-meta"><a href="${safeReportUrl(node.pageUrl)}">${copy.openPage}</a><code>${escapeHtml(stringifyEvidence(node.target))}</code></div>${node.failureSummary ? `<p class="failure-summary">${escapeHtml(node.failureSummary)}</p>` : ""}<p class="resolution-copy"><strong>${copy.conclusion}</strong>${escapeHtml(resolution.label)}</p><pre>${escapeHtml(node.html || copy.notSavedHtml)}</pre></div></details>`;
    })
    .join("");
  const evidenceSummary = issue.nodes.length
    ? `${copy.evidence.replace("{n}", String(issue.nodes.length))}`
    : `${copy.ruleNodes.replace("{n}", String(issue.nodeCount))}`;
  return `<article class="issue-card impact-${impact.className}"><div class="issue-rail" aria-hidden="true"></div><div class="issue-content"><div class="issue-header"><div><div class="issue-tags"><span class="impact-badge">${escapeHtml(impact.label)}</span><span class="type-badge">${escapeHtml(issueType)}</span></div><h3><code>${escapeHtml(issue.ruleId)}</code>${escapeHtml(issue.help)}</h3></div><div class="node-count"><strong>${issue.nodeCount}</strong><span>${copy.nodesUnit}</span></div></div><div class="issue-actions"><a href="${safeReportUrl(issue.helpUrl)}">${copy.rule}</a><span>${escapeHtml(evidenceSummary)}</span></div>${evidence ? `<div class="evidence-list">${evidence}</div>` : `<p class="evidence-unavailable">${copy.noEvidence}</p>`}</div></article>`;
}

function normalizeImpact(impact: string | null, copy: (typeof reportCopy)[ReportLocale]) {
  switch (impact) {
    case "critical":
      return { className: "critical", label: copy.critical };
    case "serious":
      return { className: "serious", label: copy.serious };
    case "moderate":
      return { className: "moderate", label: copy.moderate };
    case "minor":
      return { className: "minor", label: copy.minor };
    default:
      return { className: "unknown", label: copy.unknown };
  }
}

function resolutionText(
  resolution: NodeResolution | null,
  resultType: string,
  copy: (typeof reportCopy)[ReportLocale],
) {
  if (resolution?.source === "manual") {
    return { className: "manual", label: `${copy.manualPrefix}${verdictLabel(resolution.verdict, copy)}` };
  }
  if (resolution?.source === "ai") {
    return { className: "ai", label: `${copy.aiPrefix}${verdictLabel(resolution.verdict, copy)}` };
  }
  if (resolution?.source === "raw" || resultType === "incomplete") {
    return { className: "raw", label: copy.rawIncomplete };
  }
  return { className: "automatic", label: copy.automaticIssue };
}

function verdictLabel(verdict: ResolutionVerdict | null, copy: (typeof reportCopy)[ReportLocale]) {
  if (verdict === "problem") return copy.problem;
  if (verdict === "not_problem") return copy.notProblem;
  if (verdict === "uncertain") return copy.uncertain;
  return copy.noConclusion;
}

function displayScore(score: number | null) {
  return score === null ? "—" : `${score} / 100`;
}

function sumVerdicts(counts: Record<ResolutionVerdict, number>) {
  return counts.problem + counts.not_problem + counts.uncertain;
}

function stringifyEvidence(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value ?? "");
  }
}

function shortUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return value;
  }
}

function safeReportUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "#";
  } catch {
    return "#";
  }
}

function reportStyles() {
  return `:root{color-scheme:light;--ink:#102a43;--muted:#5d7286;--line:#d7e2ec;--paper:#fff;--canvas:#f4f7fa;--teal:#147ba5;--teal-soft:#eaf6fa;--critical:#b42318;--serious:#c2410c;--moderate:#a16207;--minor:#146c94;--unknown:#526173}*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans CJK SC",sans-serif;line-height:1.55}.report-shell{max-width:1180px;margin:38px auto 64px;padding:0 26px}.report-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:32px;align-items:end;padding:38px 42px;background:linear-gradient(135deg,#102a43 0%,#153d5c 72%,#147ba5 180%);color:#fff;border-radius:18px 18px 0 0;box-shadow:0 16px 38px rgba(20,49,74,.14)}.eyebrow,.section-kicker{margin:0 0 8px;color:#81d6ee;font-size:12px;font-weight:800;letter-spacing:.12em}.report-hero h1{margin:0;font-size:clamp(30px,4vw,48px);line-height:1.14;letter-spacing:-.035em}.origin{margin:12px 0 6px;font-size:18px}.origin a{color:#d8f4fb}.report-meta{margin:0;color:#c7dbe8;font-size:14px}.report-meta span{padding:0 8px}.score-stamp{min-width:178px;padding:18px 20px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);border-radius:14px;text-align:right}.score-stamp span,.score-stamp small{display:block}.score-stamp span{font-size:13px;color:#c7e8f1}.score-stamp strong{display:block;font-size:32px;letter-spacing:-.04em;white-space:nowrap}.score-stamp small{color:#d5e2eb;font-size:13px}.score-context{display:flex;justify-content:space-between;gap:24px;padding:18px 24px;background:#eaf6fa;border-left:5px solid var(--teal);border-radius:0 0 14px 14px}.score-context p{margin:0}.muted{color:var(--muted)}.summary-grid,.principle-grid,.resolution-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.summary-grid{margin:24px 0}.summary-grid article,.principle-grid article,.resolution-grid article{min-height:128px;padding:18px 20px;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 5px 14px rgba(20,49,74,.045)}.summary-grid span,.principle-grid span,.resolution-grid span{display:block;color:var(--muted);font-size:13px;font-weight:700}.summary-grid strong,.principle-grid strong,.resolution-grid strong{display:block;margin:6px 0 2px;font-size:30px;line-height:1.12;letter-spacing:-.035em}.summary-grid small,.principle-grid small,.resolution-grid small{display:block;color:var(--muted);font-size:12px}.report-section{margin-top:28px;padding:30px;background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 24px rgba(20,49,74,.05)}.section-heading{display:flex;justify-content:space-between;gap:26px;align-items:end;margin-bottom:22px}.section-heading h2{margin:0;font-size:25px;letter-spacing:-.025em}.section-heading p:not(.section-kicker){max-width:470px;margin:0;color:var(--muted);font-size:14px}.score-section .section-kicker{color:var(--teal)}.issue-list{display:grid;gap:14px}.issue-card{display:grid;grid-template-columns:6px minmax(0,1fr);overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#fff}.issue-rail{background:var(--unknown)}.impact-critical .issue-rail{background:var(--critical)}.impact-serious .issue-rail{background:var(--serious)}.impact-moderate .issue-rail{background:var(--moderate)}.impact-minor .issue-rail{background:var(--minor)}.issue-content{padding:20px 22px}.issue-header{display:flex;justify-content:space-between;gap:20px;align-items:start}.issue-tags{display:flex;gap:8px;align-items:center;margin-bottom:10px}.impact-badge,.type-badge,.resolution{display:inline-flex;align-items:center;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:750;white-space:nowrap}.impact-badge{background:#edf1f5;color:var(--unknown)}.impact-critical .impact-badge{background:#fee4e2;color:#8d1810}.impact-serious .impact-badge{background:#ffedd5;color:#9a3412}.impact-moderate .impact-badge{background:#fef3c7;color:#854d0e}.impact-minor .impact-badge{background:#e0f2fe;color:#075985}.type-badge{background:#eef4f8;color:#426277}.issue-card h3{margin:0;font-size:18px;line-height:1.35}.issue-card h3 code{display:block;margin-bottom:4px;color:#174b70;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px}.node-count{min-width:72px;text-align:right}.node-count strong{display:block;font-size:27px;line-height:1}.node-count span{font-size:12px;color:var(--muted)}.issue-actions{display:flex;justify-content:space-between;gap:14px;margin-top:16px;padding:11px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13px}.issue-actions a,.evidence-meta a,td a,.origin a{overflow-wrap:anywhere}.issue-actions a,.evidence-meta a,td a{color:#066d9c;font-weight:700;text-decoration-thickness:1px;text-underline-offset:2px}.issue-actions span{color:var(--muted)}.evidence-list{display:grid;gap:8px;margin-top:12px}.node-evidence{border:1px solid #dfe8ef;border-radius:10px;background:#fbfdfe}.node-evidence summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 13px;cursor:pointer;font-size:13px;font-weight:700}.node-evidence summary span:nth-child(2){overflow:hidden;color:var(--muted);font-weight:500;text-overflow:ellipsis;white-space:nowrap}.node-evidence-body{padding:0 13px 13px;border-top:1px solid #e2ebf1}.evidence-meta{display:grid;gap:7px;margin:12px 0}.evidence-meta code{display:block;max-width:100%;padding:8px 9px;background:#f0f5f8;border-radius:6px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.failure-summary{margin:10px 0;padding:9px 11px;border-left:3px solid #d48c37;background:#fff8eb;font-size:13px}.resolution-copy{margin:10px 0;font-size:13px}.resolution.manual{background:#e3f3e8;color:#17613d}.resolution.ai{background:#e8f1fd;color:#1b5d9d}.resolution.raw{background:#f8ead5;color:#8a4b08}.resolution.automatic{background:#feeceb;color:#9b1c1c}pre{margin:10px 0 0;max-height:300px;padding:13px;border-radius:8px;background:#0e2133;color:#e7f1f7;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.evidence-unavailable{margin:15px 0 0;color:var(--muted);font-size:13px}.resolution-grid article{min-height:150px}.resolution-grid article:nth-child(2){border-top:3px solid #27805a}.resolution-grid article:nth-child(3){border-top:3px solid #3479bd}.resolution-grid article:nth-child(4){border-top:3px solid #c98224}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:12px 13px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#f0f6f9;color:#38566c;font-size:12px;letter-spacing:.03em}td{overflow-wrap:anywhere}.empty-state{padding:24px;border:1px dashed #b8cad8;border-radius:10px;background:#f8fbfc}.empty-state strong{font-size:17px}.empty-state p{margin:5px 0 0;color:var(--muted)}.report-boundary{margin-top:28px;padding:22px 24px;border-left:5px solid var(--teal);border-radius:10px;background:#eaf6fa}.report-boundary strong{font-size:17px}.report-boundary p{margin:6px 0 0}footer{padding:20px 4px;color:var(--muted);font-size:12px}@page{size:A4;margin:14mm}@media(max-width:760px){.report-shell{margin:0 auto 32px;padding:0 12px}.report-hero{grid-template-columns:1fr;padding:28px 22px;border-radius:0}.score-stamp{text-align:left}.score-context,.section-heading{display:grid;gap:10px}.summary-grid,.principle-grid,.resolution-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-section{padding:22px 18px}.issue-content{padding:17px}.issue-header{gap:12px}.node-evidence summary{grid-template-columns:auto minmax(0,1fr)}.node-evidence summary .resolution{grid-column:1/-1;justify-self:start}.issue-actions{display:grid}.report-meta span{padding:0 4px}}@media print{body{background:#fff}.report-shell{max-width:none;margin:0;padding:0}.report-hero{padding:20px 24px;box-shadow:none;border-radius:0}.score-context{border-radius:0}.report-section{break-inside:auto;box-shadow:none}.issue-card,.summary-grid article,.principle-grid article,.resolution-grid article,.report-boundary{break-inside:avoid}.node-evidence>summary{list-style:none}.node-evidence>summary::-webkit-details-marker{display:none}.node-evidence:not([open])>*:not(summary){display:block!important}.node-evidence-body{display:block!important}pre{max-height:none;overflow:visible}a{color:inherit;text-decoration:none}.summary-grid,.principle-grid,.resolution-grid{gap:8px}.summary-grid article,.principle-grid article,.resolution-grid article{padding:12px}.report-section{margin-top:16px;padding:18px}.section-heading{margin-bottom:14px}}`;
}

export function renderRunReport(runId: string) {
  const dto = buildRunReportDto(runId);
  const target = path.join(config.privateEvidenceRoot, "reports", runId);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, "report.html");
  fs.writeFileSync(file, renderRunReportHtml(dto), "utf8");
  return { file, score: dto.score, dto };
}
function escapeHtml(value: unknown) {
  const text = String(value ?? "");
  return text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

function pageStatusLabel(status: string, copy: (typeof reportCopy)[ReportLocale]) {
  if (status === "success") return copy.lang === "en-US" ? "Success" : "成功";
  if (status === "failed") return copy.lang === "en-US" ? "Failed" : "失败";
  return status;
}
