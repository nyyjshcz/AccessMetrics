import fs from "node:fs";
import path from "node:path";

export type ReportStyle = {
  templateVersion: "report-style-v1";
  fontFamily: string;
  pageSize: "A4";
  language: "zh-CN";
  candidateHeader: string;
};

export function loadReportStyle(root = process.cwd()): ReportStyle {
  const file = path.join(root, "docs", "templates", "report-style.json");
  if (!fs.existsSync(file)) throw new Error("缺少 docs/templates/report-style.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  if (
    raw.templateVersion !== "report-style-v1" ||
    raw.fontFamily !== "Noto Sans CJK SC" ||
    raw.pageSize !== "A4" ||
    raw.language !== "zh-CN" ||
    raw.candidateHeader !== "REVIEW CANDIDATE — NOT FINAL"
  )
    throw new Error("docs/templates/report-style.json 不符合 report-style-v1");
  return raw as ReportStyle;
}
