import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { buildRunScore } from "./run-score";
import { config } from "./config";
export function renderRunReport(runId: string) {
  const run = getDb()
    .prepare(
      "SELECT r.*,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
    )
    .get(runId) as any;
  if (!run) throw new Error("run not found");
  const score = buildRunScore(runId);
  const target = path.join(config.privateEvidenceRoot, "reports", runId);
  fs.mkdirSync(target, { recursive: true });
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AccessCheck 报告</title><style>body{font-family:system-ui;max-width:960px;margin:40px auto;color:#172033}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd6e0;padding:8px;text-align:left}.score{font-size:42px;font-weight:700}</style></head><body><h1>${escapeHtml(run.name)}</h1><p>${escapeHtml(run.origin)}</p><div class="score">${score.overall === null ? "无可计算数据" : `${score.overall} / 100`}</div><p>模型：${score.modelVersion}；页面 ${score.pageCount}；规则 ${score.ruleCount}；自动通过节点 ${score.automaticPassNodes}；自动失败节点 ${score.automaticFailNodes}；需要人工检查 ${score.resultNodeCounts.incomplete}；不适用 ${score.resultNodeCounts.inapplicable}；best-practice 问题 ${score.bestPracticeIssueCount}；AAA 问题 ${score.aaaIssueCount}；未能解析 WCAG 条款 ${score.unmappedWcagIssueCount}；加权失败值 ${score.weightedDefects}</p><table><caption>四项原则分数</caption><thead><tr><th scope="col">原则</th><th scope="col">分数</th></tr></thead><tbody>${[
    ["可感知", score.perceivable],
    ["可操作", score.operable],
    ["易理解", score.understandable],
    ["兼容性", score.robust],
  ]
    .map(([name, value]) => `<tr><td>${name}</td><td>${value ?? "N/A"}</td></tr>`)
    .join(
      "",
    )}</tbody></table><p>本项目仅评价 axe-core 能够自动判断的网页无障碍检查项。分数不等同于完整人工审计、官方 WCAG 合规认证或“符合 WCAG 的百分比”。需要人工判断的项目会单独列出。</p></body></html>`;
  const file = path.join(target, "report.html");
  fs.writeFileSync(file, html);
  return { file, score };
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
