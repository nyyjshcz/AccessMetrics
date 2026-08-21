import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";

type JsonObject = Record<string, unknown>;
const options: Record<string, string> = {};
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === "--" || !argument.startsWith("--")) continue;
  options[argument.slice(2)] = process.argv[index + 1] ?? "";
  index++;
}
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm analysis:candidate -- --source-report-data <absolute-json> --source-export <absolute-dir> --review-freeze <absolute-file-or-dir> --model-decision <absolute-file> --model-observations <absolute-file> --created-from-commit <40-64 hex> --output <absolute-json> [--report-localization-draft <absolute-file>]",
  );
  process.exit(0);
}

const required = [
  "source-report-data",
  "source-export",
  "review-freeze",
  "model-decision",
  "model-observations",
  "created-from-commit",
  "output",
];
for (const key of required) {
  if (!options[key]) throw new Error(`缺少 --${key}`);
  if (!path.isAbsolute(options[key]) && key !== "created-from-commit")
    throw new Error(`--${key} 必须是绝对路径`);
}
if (!/^[a-f0-9]{40,64}$/.test(options["created-from-commit"]))
  throw new Error("created-from-commit 必须是 40–64 位小写十六进制 commit SHA");
const localizationPath = options["report-localization-draft"]
  ? options["report-localization-draft"]
  : path.join(process.cwd(), "scoring", "rule-localizations.zh-CN.json");
if (!path.isAbsolute(localizationPath)) throw new Error("report-localization-draft 必须是绝对路径");

function readJson(file: string): JsonObject {
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path.basename(file)} 必须是 JSON 对象`);
  return value as JsonObject;
}
function requiredString(data: JsonObject, field: string): string {
  const value = data[field];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`source report-data 缺少有效字段: ${field}`);
  return value;
}
function contentListing(root: string): Array<{ path: string; bytes: number; sha256: string }> {
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    const bytes = fs.readFileSync(root);
    return [{ path: path.basename(root), bytes: bytes.length, sha256: sha256(bytes) }];
  }
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`符号链接不允许进入输入: ${full}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(full);
        files.push({
          path: path.relative(root, full).replaceAll(path.sep, "/"),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
function requireObject(data: JsonObject, field: string): JsonObject {
  const value = data[field];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`source report-data 字段必须是对象: ${field}`);
  return value as JsonObject;
}

const sourceManifestPath = path.join(options["source-export"], "manifest.json");
if (!fs.existsSync(sourceManifestPath)) throw new Error("source export 缺少 manifest.json");
for (const file of [
  options["source-report-data"],
  options["review-freeze"],
  options["model-decision"],
  options["model-observations"],
  localizationPath,
])
  if (!fs.existsSync(file)) throw new Error(`输入不存在: ${file}`);
const sourceManifest = readJson(sourceManifestPath);
const sourceManifestHash = sha256(fs.readFileSync(sourceManifestPath));
const sourceExportId = requiredString(sourceManifest, "exportId");
const sourceData = readJson(options["source-report-data"]);
if (sourceData.schemaVersion !== "report-data-v1")
  throw new Error("source report-data 必须是已验证分析输出 report-data-v1");
if (sourceData.exportId !== sourceExportId && sourceData.sourceExportId !== sourceExportId)
  throw new Error("source report-data 与 source manifest 的 exportId 不一致");
const studyFreezeId = requiredString(sourceData, "studyFreezeId");
const populationDigest = requiredString(sourceData, "populationDigest");
if (!/^[a-f0-9]{64}$/.test(populationDigest)) throw new Error("populationDigest 必须是 SHA-256");
const reviewFreezeHash = sha256(
  Buffer.from(canonicalize(contentListing(options["review-freeze"]))),
);
const modelDecisionHash = sha256(fs.readFileSync(options["model-decision"]));
const modelObservationsHash = sha256(fs.readFileSync(options["model-observations"]));
const reportLocalizationDraftHash = sha256(fs.readFileSync(localizationPath));

const sharedFields = [
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
for (const field of sharedFields) {
  if (!(field in sourceData)) throw new Error(`source report-data 缺少统计字段: ${field}`);
  if (field === "frameCoverageSummary" || field === "scores" || field === "manualValidation")
    requireObject(sourceData, field);
}
const candidate: JsonObject = {
  schemaVersion: "report-data-candidate-v1",
  artifactKind: "candidate",
  sourceExportId,
  sourceManifestHash,
  studyFreezeId,
  populationDigest,
  reviewFreezeHash,
  reportLocalizationDraftHash,
  modelDecisionHash,
  modelObservationsHash,
  createdFromCommit: options["created-from-commit"],
  provenance: {
    ...requireObject(sourceData, "provenance"),
    analysisVersion: "accesscheck-analysis-candidate-v1",
    codeCommit: options["created-from-commit"],
  },
};
for (const field of sharedFields) candidate[field] = sourceData[field];
const bytes = Buffer.from(`${canonicalize(candidate)}\n`);
if (fs.existsSync(options.output)) {
  if (!fs.readFileSync(options.output).equals(bytes))
    throw new Error("candidate report-data 已存在但字节不同，拒绝覆盖");
  console.log(
    JSON.stringify({ output: options.output, status: "reused", sha256: sha256(bytes) }, null, 2),
  );
  process.exit(0);
}
fs.mkdirSync(path.dirname(options.output), { recursive: true });
const temporary = `${options.output}.tmp-${process.pid}`;
fs.writeFileSync(temporary, bytes);
fs.renameSync(temporary, options.output);
console.log(
  JSON.stringify(
    { output: options.output, status: "candidate_created", sha256: sha256(bytes) },
    null,
    2,
  ),
);
