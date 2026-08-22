import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../src/lib/canonical";
import { positionalArgs } from "./cli-args";

if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm export:verify -- <absolute-export-directory> [expected-manifest-sha256]",
  );
  process.exit(0);
}
const [directory, expected] = positionalArgs();
if (!directory || !path.isAbsolute(directory)) throw new Error("export directory must be absolute");
const manifestPath = path.join(directory, "manifest.json");
const digestPath = path.join(directory, "manifest.sha256");
if (!fs.existsSync(manifestPath) || !fs.existsSync(digestPath))
  throw new Error("manifest.json and manifest.sha256 are required");
const manifestBytes = fs.readFileSync(manifestPath);
const actual = sha256(manifestBytes);
const recorded = fs.readFileSync(digestPath, "utf8").trim();
if (actual !== recorded || (expected && expected !== actual))
  throw new Error(`manifest hash mismatch: ${actual}`);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  schemaVersion?: string;
  exportId?: string;
  exportKind?: string;
  files?: Array<{ path: string; size: number; sha256: string }>;
  revision?: number;
  sourceExportId?: string | null;
  sourceManifestHash?: string | null;
  outcomeDigest?: string | null;
  reviewFreezeHash?: string | null;
  reportLocalizationHash?: string | null;
  modelDecisionHash?: string | null;
  modelObservationsHash?: string | null;
  r4EvidenceBundleHash?: string | null;
};
if (manifest.schemaVersion !== "canonical-manifest-json-v1" || !manifest.exportId)
  throw new Error("manifest schemaVersion/exportId 无效");
if (!Array.isArray(manifest.files)) throw new Error("manifest.files 必须是数组");
if (
  manifest.exportKind?.startsWith("study_") &&
  (!Number.isInteger(manifest.revision) || Number(manifest.revision) < 1)
)
  throw new Error("manifest.revision 必须是正整数");
const seen = new Set<string>();
for (const file of manifest.files ?? []) {
  if (!file.path || path.isAbsolute(file.path) || file.path.includes(".."))
    throw new Error(`unsafe manifest path: ${file.path}`);
  if (file.path === "manifest.json" || file.path === "manifest.sha256" || seen.has(file.path))
    throw new Error(`manifest files cannot self-list or repeat: ${file.path}`);
  seen.add(file.path);
  const payload = path.join(directory, file.path);
  if (!fs.existsSync(payload)) throw new Error(`missing payload: ${file.path}`);
  const bytes = fs.readFileSync(payload);
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256)
    throw new Error(`payload hash mismatch: ${file.path}`);
  if (path.extname(file.path).toLowerCase() === ".csv" && "rows" in file) {
    if (!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
      throw new Error(`CSV 缺少 UTF-8 BOM: ${file.path}`);
    if (!bytes.toString("utf8").endsWith("\r\n"))
      throw new Error(`CSV 必须使用 CRLF: ${file.path}`);
    const rows = Math.max(
      0,
      bytes
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .split("\r\n")
        .filter((line) => line.length > 0).length - 1,
    );
    if (rows !== (file as { rows?: number }).rows)
      throw new Error(`CSV row count mismatch: ${file.path}`);
  }
}
function walkPayload(directoryPath: string, prefix = ""): string[] {
  return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walkPayload(path.join(directoryPath, entry.name), relative);
    return [relative.replaceAll(path.sep, "/")];
  });
}
const actualFiles = walkPayload(directory)
  .filter((file) => file !== "manifest.json" && file !== "manifest.sha256")
  .sort();
const listedFiles = [...seen].sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(listedFiles))
  throw new Error("manifest.files 必须完整列出导出目录中的所有 payload");
if (manifest.exportKind === "study_source") {
  for (const [field, value] of [
    ["sourceExportId", manifest.sourceExportId],
    ["sourceManifestHash", manifest.sourceManifestHash],
    ["outcomeDigest", manifest.outcomeDigest],
    ["reviewFreezeHash", manifest.reviewFreezeHash],
    ["reportLocalizationHash", manifest.reportLocalizationHash],
    ["modelDecisionHash", manifest.modelDecisionHash],
    ["modelObservationsHash", manifest.modelObservationsHash],
    ["r4EvidenceBundleHash", manifest.r4EvidenceBundleHash],
  ] as const)
    if (value !== null && value !== undefined) throw new Error(`study_source 不得包含 ${field}`);
  if (
    seen.has("configs/rule-localizations.report.zh-CN.json") ||
    seen.has("analysis/model-decision-record.md")
  )
    throw new Error("study_source 不得包含 R4/final 材料");
}
if (manifest.exportKind === "study_final") {
  for (const [field, value] of [
    ["sourceExportId", manifest.sourceExportId],
    ["sourceManifestHash", manifest.sourceManifestHash],
    ["outcomeDigest", manifest.outcomeDigest],
    ["reviewFreezeHash", manifest.reviewFreezeHash],
    ["reportLocalizationHash", manifest.reportLocalizationHash],
    ["modelDecisionHash", manifest.modelDecisionHash],
    ["modelObservationsHash", manifest.modelObservationsHash],
    ["r4EvidenceBundleHash", manifest.r4EvidenceBundleHash],
  ] as const)
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
      throw new Error(`study_final 缺少有效冻结字段 ${field}`);
  for (const required of [
    "configs/rule-localizations.report.zh-CN.json",
    "analysis/model-decision-record.md",
    "analysis/model-observations.md",
  ])
    if (!seen.has(required)) throw new Error(`study_final 缺少 ${required}`);
}
const studyJson = path.join(directory, "data", "study.json");
if (fs.existsSync(studyJson)) {
  const value = JSON.parse(fs.readFileSync(studyJson, "utf8")) as Record<string, unknown>;
  if (
    value.schemaVersion !== "study-export-v1" ||
    typeof value.exportId !== "string" ||
    value.exportId !== manifest.exportId ||
    !["study_source", "study_final"].includes(String(value.exportKind)) ||
    !Array.isArray(value.runSet)
  )
    throw new Error("data/study.json schema 或 manifest 绑定无效");
  if (
    value.exportKind !== manifest.exportKind ||
    value.studyFreezeId !== (manifest as any).studyFreezeId
  )
    throw new Error("data/study.json 与 manifest 的研究绑定不一致");
}
console.log(
  JSON.stringify({ verified: true, manifestHash: actual, fileCount: manifest.files?.length ?? 0 }),
);
