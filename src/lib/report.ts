import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { buildRunScore } from "./run-score";
import { config } from "./config";

export type AuthorizedRunReportDto = {
  runId: string;
  site: { name: string; origin: string };
  score: ReturnType<typeof buildRunScore>;
  generatedAt: string;
};

export function buildRunReportDto(runId: string): AuthorizedRunReportDto {
  const run = getDb()
    .prepare(
      "SELECT r.id,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
    )
    .get(runId) as { id: string; origin: string; name: string } | undefined;
  if (!run) throw new Error("run not found");
  return {
    runId,
    site: { name: run.name, origin: run.origin },
    score: buildRunScore(runId),
    generatedAt: new Date().toISOString(),
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
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AccessCheck 报告 - ${escapeHtml(dto.site.name)}</title><style>:root{color-scheme:light}body{font-family:system-ui,"Noto Sans CJK SC",sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#172033;line-height:1.55}h1{margin-bottom:4px}.muted{color:#526173}.score{font-size:42px;font-weight:700;margin:24px 0 8px}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #ccd6e0;padding:8px;text-align:left}caption{text-align:left;font-weight:700;padding-bottom:8px}.disclaimer{border-left:4px solid #527da5;padding:12px 16px;background:#f1f6fa}.provenance{font-size:12px;color:#526173}@media print{body{margin:0;max-width:none}.disclaimer{break-inside:avoid}}</style></head><body><main><h1>${escapeHtml(dto.site.name)}</h1><p class="muted">${escapeHtml(dto.site.origin)}</p><div class="score">${score.overall === null ? "无可计算数据" : `${score.overall} / 100`}</div><p>模型：${escapeHtml(score.modelVersion)}；页面 ${score.pageCount}；规则 ${score.ruleCount}；自动通过节点 ${score.automaticPassNodes}；自动失败节点 ${score.automaticFailNodes}；需要人工检查 ${score.resultNodeCounts.incomplete}；不适用 ${score.resultNodeCounts.inapplicable}。</p><table><caption>四项原则分数</caption><thead><tr><th scope="col">原则</th><th scope="col">分数</th></tr></thead><tbody>${rows}</tbody></table><p class="disclaimer">本项目仅评价 axe-core 能够自动判断的网页无障碍检查项。分数不等同于完整人工审计、官方 WCAG 合规认证或“符合 WCAG 的百分比”。需要人工判断的项目会单独列出。</p><p class="provenance">报告生成时间：${escapeHtml(dto.generatedAt)}；run：${escapeHtml(dto.runId)}</p></main></body></html>`;
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
