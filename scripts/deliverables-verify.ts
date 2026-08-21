import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { scanPublicationDirectory } from "../src/lib/privacy";
import { listGateFiles } from "./gate-utils";

const options: Record<string, string> = {};
for (let index = 2; index < process.argv.length; index++) {
  if (!process.argv[index].startsWith("--")) continue;
  options[process.argv[index].slice(2)] = process.argv[index + 1] ?? "";
  index++;
}
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm deliverables:verify -- --final-export-path <absolute-dir> --expected-manifest-sha256 <sha256> [--report-data <absolute-json>] [--reports-root <absolute-dir>] [--gate-evidence-path <absolute-dir>] [--expected-r4-evidence-bundle-sha256 <sha256>] [--expected-full-gate-bundle-sha256 <sha256>]",
  );
  process.exit(0);
}

const root = options["final-export-path"];
if (!root || !path.isAbsolute(root) || !options["expected-manifest-sha256"])
  throw new Error("需要绝对 final-export-path 和 expected-manifest-sha256");
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
if (reportDataPath) {
  if (!path.isAbsolute(reportDataPath) || !fs.existsSync(reportDataPath))
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
    const prohibited = [
      "accuracyRate",
      "falsePositiveRate",
      "falseNegativeRate",
      "citywideEstimate",
    ];
    if (
      prohibited.some((field) => field in (reportData.manualValidation as Record<string, unknown>))
    )
      throw new Error("manualValidation 不得包含总体准确率或全市外推字段");
  }
}

const reportsRoot = options["reports-root"];
if (reportsRoot) {
  if (!path.isAbsolute(reportsRoot) || !fs.existsSync(reportsRoot))
    throw new Error("reports-root 必须是存在的绝对路径");
  const reportFiles = fs
    .readdirSync(reportsRoot)
    .filter((file) => /\.(?:md|docx|pdf)$/i.test(file));
  if (!reportFiles.some((file) => file.endsWith(".md")))
    throw new Error("报告目录缺少 Markdown 报告");
  for (const file of reportFiles) {
    const bytes = fs.readFileSync(path.join(reportsRoot, file));
    if (file.endsWith(".md") && !bytes.toString("utf8").includes(manifestHash))
      throw new Error(`报告未引用 final manifest hash: ${file}`);
  }
}

if (options["gate-evidence-path"]) {
  const evidenceRoot = options["gate-evidence-path"];
  if (!path.isAbsolute(evidenceRoot)) throw new Error("gate-evidence-path 必须是绝对路径");
  const r4 = listGateFiles(evidenceRoot, ["R1", "R2", "R3", "R4"]);
  const r4Hash = sha256(canonicalize(r4.map((file) => ({ path: file.path, sha256: file.sha256 }))));
  if (r4Hash !== options["expected-r4-evidence-bundle-sha256"])
    throw new Error("R4 evidence bundle hash mismatch");
  if (
    options["expected-full-gate-bundle-sha256"] &&
    !/^[a-f0-9]{64}$/.test(options["expected-full-gate-bundle-sha256"])
  )
    throw new Error("full gate bundle hash 无效");
}

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
