import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { ReportDocument } from "@/components/report-document";
import { config } from "./config";
import { buildRunReportDto, type ReportModel } from "./report";
import { reportCopy, type ReportLocale } from "./report-copy";
export type { ReportLocale } from "./report-copy";

async function renderReportBody(dto: ReportModel, locale: ReportLocale): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(ReportDocument, { model: dto, locale }),
  );
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return html + decoder.decode();
}

/** Render the canonical report body inside a standalone HTML document. */
export async function renderRunReportHtml(
  dto: ReportModel,
  locale: ReportLocale = "zh-CN",
): Promise<string> {
  const copy = reportCopy[locale] ?? reportCopy["zh-CN"];
  const body = await renderReportBody(dto, locale);
  return `<!doctype html><html lang="${copy.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(copy.title)} - ${escapeHtml(dto.site.name)}</title><style>${reportStyles()}</style></head><body>${body}</body></html>`;
}

export function renderLanguageControl(locale: ReportLocale, returnTo: string): string {
  const option = (value: ReportLocale, label: string) =>
    `<form method="post" action="/api/preferences/locale"><input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}"/><input type="hidden" name="locale" value="${value}"/><button type="submit" aria-pressed="${locale === value}"${locale === value ? " disabled" : ""}>${label}</button></form>`;
  return `<nav aria-label="语言 / Language" class="report-language">${option("zh-CN", "中文")}<span aria-hidden="true">|</span>${option("en", "EN")}</nav>`;
}
export function reportStyles() {
  return `:root{color-scheme:light;--ink:#102a43;--muted:#5d7286;--line:#d7e2ec;--paper:#fff;--canvas:#f4f7fa;--teal:#147ba5;--teal-soft:#eaf6fa;--critical:#b42318;--serious:#c2410c;--moderate:#a16207;--minor:#146c94;--unknown:#526173}*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans CJK SC",sans-serif;line-height:1.55}.report-shell{max-width:1180px;margin:38px auto 64px;padding:0 26px}.report-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:32px;align-items:end;padding:38px 42px;background:linear-gradient(135deg,#102a43 0%,#153d5c 72%,#147ba5 180%);color:#fff;border-radius:18px 18px 0 0;box-shadow:0 16px 38px rgba(20,49,74,.14)}.eyebrow,.section-kicker{margin:0 0 8px;color:#81d6ee;font-size:12px;font-weight:800;letter-spacing:.12em}.report-hero h1{margin:0;font-size:clamp(30px,4vw,48px);line-height:1.14;letter-spacing:-.035em}.origin{margin:12px 0 6px;font-size:18px}.origin a{color:#d8f4fb}.report-meta{margin:0;color:#c7dbe8;font-size:14px}.report-meta span{padding:0 8px}.score-stamp{min-width:178px;padding:18px 20px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);border-radius:14px;text-align:right}.score-stamp span,.score-stamp small{display:block}.score-stamp span{font-size:13px;color:#c7e8f1}.score-stamp strong{display:block;font-size:32px;letter-spacing:-.04em;white-space:nowrap}.score-stamp small{color:#d5e2eb;font-size:13px}.score-context{display:flex;justify-content:space-between;gap:24px;padding:18px 24px;background:#eaf6fa;border-left:5px solid var(--teal);border-radius:0 0 14px 14px}.score-context p{margin:0}.muted{color:var(--muted)}.summary-grid,.principle-grid,.resolution-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.summary-grid{margin:24px 0}.summary-grid article,.principle-grid article,.resolution-grid article{min-height:128px;padding:18px 20px;background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 5px 14px rgba(20,49,74,.045)}.summary-grid span,.principle-grid span,.resolution-grid span{display:block;color:var(--muted);font-size:13px;font-weight:700}.summary-grid strong,.principle-grid strong,.resolution-grid strong{display:block;margin:6px 0 2px;font-size:30px;line-height:1.12;letter-spacing:-.035em}.summary-grid small,.principle-grid small,.resolution-grid small{display:block;color:var(--muted);font-size:12px}.report-section{margin-top:28px;padding:30px;background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 24px rgba(20,49,74,.05)}.section-heading{display:flex;justify-content:space-between;gap:26px;align-items:end;margin-bottom:22px}.section-heading h2{margin:0;font-size:25px;letter-spacing:-.025em}.section-heading p:not(.section-kicker){max-width:470px;margin:0;color:var(--muted);font-size:14px}.score-section .section-kicker{color:var(--teal)}.issue-list{display:grid;gap:14px}.issue-card{display:grid;grid-template-columns:6px minmax(0,1fr);overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#fff}.issue-rail{background:var(--unknown)}.impact-critical .issue-rail{background:var(--critical)}.impact-serious .issue-rail{background:var(--serious)}.impact-moderate .issue-rail{background:var(--moderate)}.impact-minor .issue-rail{background:var(--minor)}.issue-content{padding:20px 22px}.issue-header{display:flex;justify-content:space-between;gap:20px;align-items:start}.issue-tags{display:flex;gap:8px;align-items:center;margin-bottom:10px}.impact-badge,.type-badge,.resolution{display:inline-flex;align-items:center;border-radius:999px;padding:3px 9px;font-size:12px;font-weight:750;white-space:nowrap}.impact-badge{background:#edf1f5;color:var(--unknown)}.impact-critical .impact-badge{background:#fee4e2;color:#8d1810}.impact-serious .impact-badge{background:#ffedd5;color:#9a3412}.impact-moderate .impact-badge{background:#fef3c7;color:#854d0e}.impact-minor .impact-badge{background:#e0f2fe;color:#075985}.type-badge{background:#eef4f8;color:#426277}.issue-card h3{margin:0;font-size:18px;line-height:1.35}.issue-card h3 code{display:block;margin-bottom:4px;color:#174b70;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px}.node-count{min-width:72px;text-align:right}.node-count strong{display:block;font-size:27px;line-height:1}.node-count span{font-size:12px;color:var(--muted)}.issue-actions{display:flex;justify-content:space-between;gap:14px;margin-top:16px;padding:11px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13px}.issue-actions a,.evidence-meta a,td a,.origin a{overflow-wrap:anywhere}.issue-actions a,.evidence-meta a,td a{color:#066d9c;font-weight:700;text-decoration-thickness:1px;text-underline-offset:2px}.issue-actions span{color:var(--muted)}.evidence-list{display:grid;gap:8px;margin-top:12px}.node-evidence{border:1px solid #dfe8ef;border-radius:10px;background:#fbfdfe}.node-evidence summary{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 13px;cursor:pointer;font-size:13px;font-weight:700}.node-evidence summary span:nth-child(2){overflow:hidden;color:var(--muted);font-weight:500;text-overflow:ellipsis;white-space:nowrap}.node-evidence-body{padding:0 13px 13px;border-top:1px solid #e2ebf1}.evidence-meta{display:grid;gap:7px;margin:12px 0}.evidence-meta code{display:block;max-width:100%;padding:8px 9px;background:#f0f5f8;border-radius:6px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.failure-summary{margin:10px 0;padding:9px 11px;border-left:3px solid #d48c37;background:#fff8eb;font-size:13px}.resolution-copy{margin:10px 0;font-size:13px}.resolution.manual{background:#e3f3e8;color:#17613d}.resolution.ai{background:#e8f1fd;color:#1b5d9d}.resolution.raw{background:#f8ead5;color:#8a4b08}.resolution.automatic{background:#feeceb;color:#9b1c1c}pre{margin:10px 0 0;max-height:300px;padding:13px;border-radius:8px;background:#0e2133;color:#e7f1f7;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.evidence-unavailable{margin:15px 0 0;color:var(--muted);font-size:13px}.resolution-grid article{min-height:150px}.resolution-grid article:nth-child(2){border-top:3px solid #27805a}.resolution-grid article:nth-child(3){border-top:3px solid #3479bd}.resolution-grid article:nth-child(4){border-top:3px solid #c98224}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:12px 13px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#f0f6f9;color:#38566c;font-size:12px;letter-spacing:.03em}td{overflow-wrap:anywhere}.empty-state{padding:24px;border:1px dashed #b8cad8;border-radius:10px;background:#f8fbfc}.empty-state strong{font-size:17px}.empty-state p{margin:5px 0 0;color:var(--muted)}.report-boundary{margin-top:28px;padding:22px 24px;border-left:5px solid var(--teal);border-radius:10px;background:#eaf6fa}.report-boundary strong{font-size:17px}.report-boundary p{margin:6px 0 0}footer{padding:20px 4px;color:var(--muted);font-size:12px}@page{size:A4;margin:14mm}@media(max-width:760px){.report-shell{margin:0 auto 32px;padding:0 12px}.report-hero{grid-template-columns:1fr;padding:28px 22px;border-radius:0}.score-stamp{text-align:left}.score-context,.section-heading{display:grid;gap:10px}.summary-grid,.principle-grid,.resolution-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-section{padding:22px 18px}.issue-content{padding:17px}.issue-header{gap:12px}.node-evidence summary{grid-template-columns:auto minmax(0,1fr)}.node-evidence summary .resolution{grid-column:1/-1;justify-self:start}.issue-actions{display:grid}.report-meta span{padding:0 4px}}@media print{body{background:#fff}.report-shell{max-width:none;margin:0;padding:0}.report-hero{padding:20px 24px;box-shadow:none;border-radius:0}.score-context{border-radius:0}.report-section{break-inside:auto;box-shadow:none}.issue-card,.summary-grid article,.principle-grid article,.resolution-grid article,.report-boundary{break-inside:avoid}.node-evidence>summary{list-style:none}.node-evidence>summary::-webkit-details-marker{display:none}.node-evidence:not([open])>*:not(summary){display:block!important}.node-evidence-body{display:block!important}pre{max-height:none;overflow:visible}a{color:inherit;text-decoration:none}.summary-grid,.principle-grid,.resolution-grid{gap:8px}.summary-grid article,.principle-grid article,.resolution-grid article{padding:12px}.report-section{margin-top:16px;padding:18px}.section-heading{margin-bottom:14px}}`;
}

export async function renderRunReport(runId: string) {
  const dto = buildRunReportDto(runId);
  const target = path.join(config.privateEvidenceRoot, "reports", runId);
  fs.mkdirSync(target, { recursive: true });
  const file = path.join(target, "report.html");
  fs.writeFileSync(file, await renderRunReportHtml(dto), "utf8");
  return { file, score: dto.score, dto };
}
function escapeHtml(value: unknown) {
  const text = String(value ?? "");
  return text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
