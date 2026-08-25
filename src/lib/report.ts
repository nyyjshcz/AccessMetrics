import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { buildRunScore } from "./run-score";
import { config } from "./config";

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
  generatedAt: string;
  pages: Array<{
    canonicalUrl: string;
    scanStatus: string;
    httpStatus: number | null;
    errorCode: string | null;
    frameCoverageStatus: string | null;
  }>;
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
    }>;
  }>;
  reviewSummary: {
    confirmed: number;
    notAnIssue: number;
    uncertain: number;
    reviewed: number;
    unreviewed: number;
  };
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
  const score = buildRunScore(runId);
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
      "SELECT id,rule_id,impact,result_type,help,help_url,node_count FROM rule_results WHERE run_id=? AND result_type IN ('violation','incomplete') ORDER BY CASE impact WHEN 'critical' THEN 1 WHEN 'serious' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 ELSE 5 END,rule_id LIMIT 12",
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
    }>
  >();
  const issueIds = issues.map((issue) => issue.id);
  if (issueIds.length > 0) {
    const nodeRows = getDb()
      .prepare(
        `SELECT rn.rule_result_id,rn.ordinal,rn.target_json,rn.html_sanitized,rn.failure_summary,rn.frame_path_json,p.canonical_url FROM result_nodes rn JOIN pages p ON p.id=(SELECT page_id FROM rule_results WHERE id=rn.rule_result_id) WHERE rn.rule_result_id IN (${issueIds.map(() => "?").join(",")}) ORDER BY rn.rule_result_id,rn.ordinal`,
      )
      .all(...issueIds) as Array<{
      rule_result_id: string;
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
        pageUrl: node.canonical_url,
        target,
        html: node.html_sanitized,
        failureSummary: node.failure_summary,
        framePath,
      });
      issueNodes.set(node.rule_result_id, list);
    }
  }
  // Daily notes are intentionally separate from the fixed, blinded formal
  // review chain. Counts are distinct nodes rather than review rows: two
  // reviewers may both record a note for one node without making another node
  // look reviewed.
  const reviewCounts = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT CASE WHEN mr.verdict='confirmed' THEN n.id END) confirmed,
              COUNT(DISTINCT CASE WHEN mr.verdict='not_an_issue' THEN n.id END) not_an_issue,
              COUNT(DISTINCT CASE WHEN mr.verdict='uncertain' THEN n.id END) uncertain,
              COUNT(DISTINCT n.id) reviewed
         FROM manual_reviews mr
         JOIN result_nodes n ON n.id=mr.result_node_id
         JOIN rule_results rr ON rr.id=n.rule_result_id
        WHERE rr.run_id=? AND mr.review_context='ad_hoc' AND mr.is_current=1`,
    )
    .get(runId) as {
    confirmed: number | null;
    not_an_issue: number | null;
    uncertain: number | null;
    reviewed: number | null;
  };
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
      nodeCount: Number(issue.node_count),
      nodes: issueNodes.get(issue.id) ?? [],
    })),
    reviewSummary: {
      confirmed: Number(reviewCounts.confirmed ?? 0),
      notAnIssue: Number(reviewCounts.not_an_issue ?? 0),
      uncertain: Number(reviewCounts.uncertain ?? 0),
      reviewed: Number(reviewCounts.reviewed ?? 0),
      unreviewed: Math.max(
        0,
        score.resultNodeCounts.violation +
          score.resultNodeCounts.incomplete -
          Number(reviewCounts.reviewed ?? 0),
      ),
    },
  };
}

export function renderRunReportHtml(dto: AuthorizedRunReportDto) {
  const score = dto.score;
  const rows = (
    [
      ["可感知", score.perceivable],
      ["可操作", score.operable],
      ["易理解", score.understandable],
      ["兼容性", score.robust],
    ] as const
  )
    .map(
      ([name, value]) =>
        `<tr><th scope="row">${escapeHtml(name)}</th><td>${value ?? "N/A"}</td></tr>`,
    )
    .join("");
  const issueRows = dto.issues
    .map(
      (issue) =>
        `<tr><td>${escapeHtml(issue.ruleId)}</td><td>${escapeHtml(issue.impact ?? "N/A")}</td><td>${escapeHtml(issue.resultType === "incomplete" ? "需要人工检查" : "自动发现")}</td><td>${issue.nodeCount}</td><td><a href="${escapeHtml(issue.helpUrl)}">${escapeHtml(issue.help)}</a></td></tr>`,
    )
    .join("");
  const representativeRows = dto.issues
    .flatMap((issue) => issue.nodes.slice(0, 5).map((node) => ({ issue, node })))
    .slice(0, 12)
    .map(
      ({ issue, node }) =>
        `<tr><td>${escapeHtml(issue.ruleId)}</td><td>${escapeHtml(node.pageUrl)}</td><td><code>${escapeHtml(JSON.stringify(node.target) ?? "")}</code></td><td><pre>${escapeHtml(node.html)}</pre>${node.failureSummary ? `<p>${escapeHtml(node.failureSummary)}</p>` : ""}</td></tr>`,
    )
    .join("");
  const failedRows = dto.pages
    .filter((page) => page.scanStatus !== "success" || page.errorCode)
    .map(
      (page) =>
        `<tr><td>${escapeHtml(page.canonicalUrl)}</td><td>${escapeHtml(pageStatusLabel(page.scanStatus))}</td><td>${escapeHtml(page.errorCode ?? "")}</td><td>${page.httpStatus ?? "N/A"}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AccessCheck 报告 - ${escapeHtml(dto.site.name)}</title><style>:root{color-scheme:light}body{font-family:system-ui,"Noto Sans CJK SC",sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#172033;line-height:1.55}h1{margin-bottom:4px}.muted{color:#526173}.score{font-size:42px;font-weight:700;margin:24px 0 8px}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #ccd6e0;padding:8px;text-align:left}caption{text-align:left;font-weight:700;padding-bottom:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.disclaimer{border-left:4px solid #527da5;padding:12px 16px;background:#f1f6fa}.provenance{font-size:12px;color:#526173}@page{size:A4;margin:18mm}@media print{body{margin:0;max-width:none}.disclaimer{break-inside:avoid}}</style></head><body><main><h1>${escapeHtml(dto.site.name)}</h1><p class="muted">${escapeHtml(dto.site.origin)}</p><p class="muted">扫描完成时间：${escapeHtml(dto.run.finishedAt ?? dto.run.startedAt ?? dto.run.createdAt ?? "未记录")}; 报告生成时间：${escapeHtml(dto.generatedAt)}；页数：${dto.pages.length}；覆盖受限页：${dto.pages.filter((page) => page.frameCoverageStatus === "coverage_limited").length}</p><div class="score">${score.overall === null ? "无可计算数据" : `${score.overall} / 100`}</div><p>模型：${escapeHtml(score.modelVersion)}；规则 ${score.ruleCount}；自动通过节点 ${score.automaticPassNodes}；自动失败节点 ${score.automaticFailNodes}；需要进一步判断 ${score.resultNodeCounts.incomplete}；不适用 ${score.resultNodeCounts.inapplicable}。</p><table><caption>四项原则分数</caption><thead><tr><th scope="col">原则</th><th scope="col">分数</th></tr></thead><tbody>${rows}</tbody></table><h2>主要问题与修改入口</h2><table><caption>按严重程度排序的自动结果</caption><thead><tr><th scope="col">规则</th><th scope="col">影响</th><th scope="col">类型</th><th scope="col">节点数</th><th scope="col">帮助</th></tr></thead><tbody>${issueRows || '<tr><td colspan="5">没有 violation/incomplete 结果</td></tr>'}</tbody></table><h2>代表性节点证据</h2><table><caption>问题页面、元素定位与清理片段</caption><thead><tr><th scope="col">规则</th><th scope="col">页面</th><th scope="col">定位</th><th scope="col">清理后的元素与原因</th></tr></thead><tbody>${representativeRows || '<tr><td colspan="4">没有可展示的节点证据</td></tr>'}</tbody></table><h2>失败或未完成页面</h2><table><caption>页面状态和结构化错误</caption><thead><tr><th scope="col">页面</th><th scope="col">状态</th><th scope="col">错误</th><th scope="col">HTTP</th></tr></thead><tbody>${failedRows || '<tr><td colspan="4">没有失败或未完成页面</td></tr>'}</tbody></table><h2>日常人工核对汇总</h2><p>已覆盖 ${dto.reviewSummary.reviewed} 个节点；confirmed ${dto.reviewSummary.confirmed}；not_an_issue ${dto.reviewSummary.notAnIssue}；uncertain ${dto.reviewSummary.uncertain}；尚未日常核对 ${dto.reviewSummary.unreviewed}。一个节点若有不同 reviewer 的独立日常注记，可能同时出现在多个判断类别中；正式双人抽样在冻结前不会在这里公开。自动分数始终不变。</p><p class="disclaimer">本项目仅评价 axe-core 能够自动判断的网页无障碍检查结果。分数不等同于完整人工审计、官方 WCAG 合规认证或“符合 WCAG 的百分比”。需要进一步判断的项目会单独列出。</p><p class="provenance">run：${escapeHtml(dto.runId)}；运行状态：${escapeHtml(dto.run.status)}</p></main></body></html>`;
}

export function renderRunReport(runId: string) {
  const dto = buildRunReportDto(runId);
  const target = path.join(config.privateEvidenceRoot, "reports", runId);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, "report.html");
  fs.writeFileSync(file, renderRunReportHtml(dto), "utf8");
  return { file, score: dto.score, dto };
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

function pageStatusLabel(status: string) {
  return status === "success" ? "成功" : status === "failed" ? "失败" : status;
}
