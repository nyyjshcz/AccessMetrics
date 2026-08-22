import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { strFromU8, unzipSync } from "fflate";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { scanPublicationDirectory } from "../src/lib/privacy";
import { listEvidenceFiles, listGateFiles, verifyApprovedGate } from "./gate-utils";

const REPORT_SECTIONS = [
  "## 摘要",
  "## 1. 研究背景与问题",
  "## 2. 自动检测边界与研究范围",
  "## 3. 样本站点选择原则",
  "## 4. Playwright/axe-core 扫描方法",
  "## 5. axe 严重程度、WCAG 映射和评分公式",
  "## 6. 数据质量与失败页面处理",
  "## 7. 描述统计和四原则结果",
  "## 8. 敏感性分析",
  "## 9. 已知问题 fixture 与人工抽查验证",
  "## 10. 图表与数据表",
  "## 11. 局限",
  "## 12. 结论",
  "## 13. 参考资料",
  "## 14. 两人分工与贡献说明",
  "## 15. 附录：版本、配置和复现方法",
];

function textFromDocx(file: string): string {
  const archive = unzipSync(fs.readFileSync(file));
  const document = archive["word/document.xml"];
  if (!document) throw new Error(`DOCX 缺少 word/document.xml: ${file}`);
  return strFromU8(document)
    .replace(/<w:tab\s*\/?\s*>/g, "\t")
    .replace(/<w:br\s*\/?\s*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function textFromPdf(file: string): string {
  try {
    return execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`无法验证 PDF 文本：缺少可执行的 pdftotext 或 PDF 读取失败: ${file}`);
  }
}

function assertReportText(
  text: string,
  reportData: Record<string, unknown>,
  manifestHash: string,
  reportDataHash: string,
  markdown = false,
) {
  for (const section of REPORT_SECTIONS) {
    const marker = markdown ? section : section.replace(/^##\s+/, "");
    if (!text.includes(marker)) throw new Error(`报告缺少章节「${marker}」`);
  }
  const requiredValues = [
    manifestHash,
    reportDataHash,
    reportData.exportId,
    reportData.sourceExportId,
    reportData.populationDigest,
    reportData.generatedAt,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const value of requiredValues)
    if (!text.includes(value)) throw new Error(`报告未追溯到 report-data 值: ${value}`);
  const scores =
    reportData.scores && typeof reportData.scores === "object"
      ? (reportData.scores as Record<string, unknown>)
      : {};
  const siteScores =
    scores.siteScores && typeof scores.siteScores === "object"
      ? (scores.siteScores as Record<string, unknown>)
      : {};
  for (const [site, value] of Object.entries(siteScores)) {
    if (!text.includes(site)) throw new Error(`报告缺少站点: ${site}`);
    const score = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    for (const key of ["exact", "display", "exactNumerator", "exactDenominator"])
      if (score[key] !== undefined && score[key] !== null && !text.includes(String(score[key])))
        throw new Error(`报告缺少站点 ${site} 的 ${key}`);
  }
  const requiredArrays = ["commonRules", "limitations"];
  for (const field of requiredArrays) {
    const values = Array.isArray(reportData[field]) ? reportData[field] : [];
    for (const value of values) {
      const item = value && typeof value === "object" ? (value as Record<string, unknown>) : value;
      const marker = typeof item === "object" && item !== null ? (item.ruleId ?? item.count) : item;
      if (marker !== undefined && marker !== null && !text.includes(String(marker)))
        throw new Error(`报告缺少 ${field} 中的值: ${String(marker)}`);
    }
  }
  const charts = Array.isArray(reportData.charts) ? reportData.charts : [];
  for (const chart of charts) {
    const item = chart as Record<string, unknown>;
    if (typeof item.path === "string" && !text.includes(item.path))
      throw new Error(`报告未引用图表/数据表: ${item.path}`);
  }
}

const options: Record<string, string> = {};
for (let index = 2; index < process.argv.length; index++) {
  if (process.argv[index] === "--") continue;
  if (!process.argv[index].startsWith("--")) continue;
  options[process.argv[index].slice(2)] = process.argv[index + 1] ?? "";
  index++;
}
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm deliverables:verify -- --final-export-path <absolute-dir> --expected-manifest-sha256 <sha256> --report-data <absolute-json> --reports-root <absolute-dir> --gate-evidence-path <absolute-dir> --expected-r4-evidence-bundle-sha256 <sha256> --expected-full-gate-bundle-sha256 <sha256> [--publication-db <absolute-db>]",
  );
  process.exit(0);
}

const root = options["final-export-path"];
if (!root || !path.isAbsolute(root) || !options["expected-manifest-sha256"])
  throw new Error("需要绝对 final-export-path 和 expected-manifest-sha256");
for (const key of [
  "report-data",
  "reports-root",
  "gate-evidence-path",
  "expected-r4-evidence-bundle-sha256",
  "expected-full-gate-bundle-sha256",
])
  if (!options[key]) throw new Error(`缺少 --${key}`);
const resolvedRoot = path.resolve(root);
const manifestPath = path.join(resolvedRoot, "manifest.json");
const digestPath = path.join(resolvedRoot, "manifest.sha256");
if (!fs.existsSync(manifestPath) || !fs.existsSync(digestPath))
  throw new Error("final export 缺少 manifest.json 或 manifest.sha256");
const manifestBytes = fs.readFileSync(manifestPath);
const manifestHash = sha256(manifestBytes);
if (manifestHash !== options["expected-manifest-sha256"]) throw new Error("manifest hash mismatch");
if (fs.readFileSync(digestPath, "utf8").trim() !== manifestHash)
  throw new Error("manifest.sha256 mismatch");
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  exportId?: string;
  sourceExportId?: string;
  sourceManifestHash?: string;
  files?: Array<{ path: string; size?: number; sha256?: string }>;
};
if (!manifest.exportId || !Array.isArray(manifest.files)) throw new Error("manifest schema 不完整");
for (const file of manifest.files) {
  if (!file.path || path.isAbsolute(file.path)) throw new Error("manifest path 不安全");
  const normalized = file.path.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "." || part === ".."))
    throw new Error(`manifest path 越界: ${normalized}`);
  const absolute = path.join(resolvedRoot, normalized);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile())
    throw new Error(`manifest file missing: ${normalized}`);
  const bytes = fs.readFileSync(absolute);
  if (file.size !== undefined && file.size !== bytes.length)
    throw new Error(`manifest size mismatch: ${normalized}`);
  if (file.sha256 !== undefined && file.sha256 !== sha256(bytes))
    throw new Error(`manifest file hash mismatch: ${normalized}`);
}

const privacy = scanPublicationDirectory(resolvedRoot, manifest.exportId);
if (!privacy.passed)
  throw new Error(`隐私检查失败: ${privacy.findings.map((item) => item.ruleId).join(",")}`);

const reportDataPath = options["report-data"];
if (!reportDataPath || !path.isAbsolute(reportDataPath) || !fs.existsSync(reportDataPath))
  throw new Error("report-data 必须是存在的绝对路径");
const reportData = JSON.parse(fs.readFileSync(reportDataPath, "utf8")) as Record<string, unknown>;
const requiredFields = [
  "schemaVersion",
  "exportId",
  "manifestHash",
  "sourceExportId",
  "sourceManifestHash",
  "studyFreezeId",
  "populationDigest",
  "outcomeDigest",
  "reviewFreezeHash",
  "modelDecisionHash",
  "modelObservationsHash",
  "r4EvidenceBundleHash",
  "scanTimeLocalizationHash",
  "reportLocalizationHash",
  "generatedAt",
  "provenance",
  "sampleSummary",
  "pageStatusSummary",
  "frameCoverageSummary",
  "scores",
  "severitySummary",
  "commonRules",
  "principleSummary",
  "sensitivity",
  "manualValidation",
  "charts",
  "limitations",
];
const missing = requiredFields.filter((field) => !(field in reportData));
if (reportData.schemaVersion !== "report-data-v1" || missing.length)
  throw new Error(`report-data schema/追溯字段不完整: ${missing.join(",")}`);
if (reportData.exportId !== manifest.exportId || reportData.manifestHash !== manifestHash)
  throw new Error("report-data 未绑定当前 final export/manifest");
if (manifest.sourceExportId && reportData.sourceExportId !== manifest.sourceExportId)
  throw new Error("report-data sourceExportId 与 manifest 不一致");
if (manifest.sourceManifestHash && reportData.sourceManifestHash !== manifest.sourceManifestHash)
  throw new Error("report-data sourceManifestHash 与 manifest 不一致");
if (reportData.manualValidation && typeof reportData.manualValidation === "object") {
  const prohibited = ["accuracyRate", "falsePositiveRate", "falseNegativeRate", "citywideEstimate"];
  if (prohibited.some((field) => field in (reportData.manualValidation as Record<string, unknown>)))
    throw new Error("manualValidation 不得包含总体准确率或全市外推字段");
}
const reportDataRoot = path.dirname(reportDataPath);
const charts = Array.isArray(reportData.charts) ? reportData.charts : [];
for (const chart of charts) {
  if (!chart || typeof chart !== "object" || Array.isArray(chart))
    throw new Error("report-data charts 条目无效");
  const item = chart as Record<string, unknown>;
  if (typeof item.path !== "string" || path.isAbsolute(item.path))
    throw new Error("report-data chart path 不安全");
  const chartPath = path.resolve(reportDataRoot, item.path);
  if (!chartPath.startsWith(`${reportDataRoot}${path.sep}`) || !fs.existsSync(chartPath))
    throw new Error(`report-data chart 缺失: ${item.path}`);
  if (item.sha256 !== sha256(fs.readFileSync(chartPath)))
    throw new Error(`report-data chart hash 不一致: ${item.path}`);
}
const reportDataHash = sha256(fs.readFileSync(reportDataPath));

const reportsRoot = options["reports-root"];
if (!reportsRoot || !path.isAbsolute(reportsRoot) || !fs.existsSync(reportsRoot))
  throw new Error("reports-root 必须是存在的绝对路径");
const reportFiles: string[] = [];
const collectReports = (directory: string) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collectReports(full);
    else if (entry.isFile() && /\.(?:md|docx|pdf)$/i.test(entry.name)) reportFiles.push(full);
  }
};
collectReports(reportsRoot);
const markdownReports = reportFiles.filter((file) => file.toLowerCase().endsWith(".md"));
const docxReports = reportFiles.filter((file) => file.toLowerCase().endsWith(".docx"));
const pdfReports = reportFiles.filter((file) => file.toLowerCase().endsWith(".pdf"));
if (markdownReports.length < 2 || docxReports.length < 2 || pdfReports.length < 2)
  throw new Error("报告目录必须包含研究/应用两份 Markdown、DOCX 和 PDF");
const reportKinds = ["research", "federation"] as const;
for (const kind of reportKinds) {
  const markdown = markdownReports.find((file) => path.basename(file).toLowerCase().includes(kind));
  const docx = docxReports.find((file) => path.basename(file).toLowerCase().includes(kind));
  const pdf = pdfReports.find((file) => path.basename(file).toLowerCase().includes(kind));
  if (!markdown || !docx || !pdf) throw new Error(`缺少 ${kind} 报告的 Markdown/DOCX/PDF 三件套`);
  const markdownText = fs.readFileSync(markdown, "utf8");
  assertReportText(markdownText, reportData, manifestHash, reportDataHash, true);
  const docxText = textFromDocx(docx);
  assertReportText(docxText, reportData, manifestHash, reportDataHash);
  const pdfText = textFromPdf(pdf);
  assertReportText(pdfText, reportData, manifestHash, reportDataHash);
  for (const file of [markdown, docx, pdf]) {
    if (fs.statSync(file).size === 0)
      throw new Error(`报告文件为空: ${path.relative(reportsRoot, file)}`);
  }
  const artifactManifest = path.join(path.dirname(markdown), "report-manifest.json");
  if (!fs.existsSync(artifactManifest)) throw new Error(`缺少报告 manifest: ${artifactManifest}`);
  const artifact = JSON.parse(fs.readFileSync(artifactManifest, "utf8")) as {
    reportDataHash?: string;
    files?: Array<{ path: string; sha256: string }>;
  };
  if (artifact.reportDataHash !== reportDataHash || !Array.isArray(artifact.files))
    throw new Error(`报告 manifest 未绑定 report-data: ${artifactManifest}`);
  for (const file of artifact.files) {
    const target = path.join(path.dirname(artifactManifest), file.path);
    if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== file.sha256)
      throw new Error(`报告 manifest 文件 hash 不一致: ${file.path}`);
  }
}

const evidenceRoot = options["gate-evidence-path"];
if (!evidenceRoot || !path.isAbsolute(evidenceRoot))
  throw new Error("gate-evidence-path 必须是绝对路径");
const publicationDb = options["publication-db"] ?? process.env.DATABASE_URL;
for (const gate of ["R1", "R2", "R3", "R4", "R5"] as const)
  verifyApprovedGate(evidenceRoot, gate, publicationDb);
const r4 = listGateFiles(evidenceRoot, ["R1", "R2", "R3", "R4"]);
const r4Hash = sha256(canonicalize(r4.map((file) => ({ path: file.path, sha256: file.sha256 }))));
if (r4Hash !== options["expected-r4-evidence-bundle-sha256"])
  throw new Error("R4 evidence bundle hash mismatch");
const r5Files = listEvidenceFiles(path.join(evidenceRoot, "R5")).map((file) => ({
  path: file.path,
  sha256: file.sha256,
}));
const bundleFile = listEvidenceFiles(path.join(evidenceRoot, "R5")).find(
  (file) => file.path === "r5-artifact-bundle.json",
);
if (!bundleFile) throw new Error("R5 common artifact bundle missing");
const bundle = JSON.parse(bundleFile.bytes.toString("utf8")) as { bundleHash?: string };
if (!bundle.bundleHash) throw new Error("R5 common artifact bundle hash missing");
const fullHash = sha256(
  canonicalize({
    r4: r4Hash,
    r5: r5Files,
    r5ArtifactBundleHash: bundle.bundleHash,
    r5Receipts: verifyApprovedGate(evidenceRoot, "R5", publicationDb)
      .selected.map(({ receipt }) => receipt.receiptHash)
      .sort(),
  }),
);
if (fullHash !== options["expected-full-gate-bundle-sha256"])
  throw new Error("full gate bundle hash mismatch");

const files = fs.readdirSync(resolvedRoot, { recursive: true }).map(String).sort();
console.log(
  JSON.stringify(
    {
      verified: true,
      exportId: manifest.exportId,
      sourceExportId: manifest.sourceExportId ?? null,
      manifestHash,
      privacyCheckHash: privacy.privacyCheckHash,
      fileCount: files.length,
      files,
    },
    null,
    2,
  ),
);
