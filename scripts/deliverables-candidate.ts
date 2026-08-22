import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { assertCandidateReportData } from "./report-data-contract";

type CandidateFile = { path: string; bytes: number; sha256: string };
type CandidateData = Record<string, unknown>;

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((arg, index, array) =>
      arg !== "--" && arg.startsWith("--") ? [[arg.slice(2), array[index + 1] ?? ""]] : [],
    ),
);

if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm deliverables:candidate -- --source-export <absolute-dir> --review-freeze <absolute-file-or-dir> --candidate-files <absolute-dir> --output-root <absolute-dir> [--report-localization-draft <absolute-file>]",
  );
  process.exit(0);
}

const requiredArgs = ["source-export", "review-freeze", "candidate-files", "output-root"];
for (const key of requiredArgs) {
  if (!args[key]) throw new Error(`缺少 --${key}`);
  if (!path.isAbsolute(args[key])) throw new Error(`--${key} 必须是绝对路径`);
}
if (!fs.existsSync(args["source-export"])) throw new Error("source export 不存在");
if (!fs.existsSync(args["review-freeze"])) throw new Error("review-freeze 不存在");
const localizationPath = args["report-localization-draft"]
  ? args["report-localization-draft"]
  : path.join(process.cwd(), "scoring", "rule-localizations.zh-CN.json");
if (!path.isAbsolute(localizationPath)) throw new Error("report-localization-draft 必须是绝对路径");
if (!fs.existsSync(localizationPath)) throw new Error("report-localization-draft 不存在");
if (!fs.statSync(args["candidate-files"]).isDirectory())
  throw new Error("candidate-files 必须是候选产物目录");

function contentListing(root: string): CandidateFile[] {
  const files: CandidateFile[] = [];
  const rootStat = fs.statSync(root);
  if (rootStat.isFile()) {
    const bytes = fs.readFileSync(root);
    files.push({ path: path.basename(root), bytes: bytes.length, sha256: sha256(bytes) });
    return files;
  }
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`符号链接不允许进入 candidate: ${full}`);
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

function readJson(file: string): CandidateData {
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path.basename(file)} 必须是 JSON 对象`);
  return value as CandidateData;
}

function requireString(data: CandidateData, field: string, pattern?: RegExp): string {
  const value = data[field];
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value)))
    throw new Error(`candidate report-data 字段无效: ${field}`);
  return value;
}

const sourceManifestPath = path.join(args["source-export"], "manifest.json");
if (!fs.existsSync(sourceManifestPath)) throw new Error("source export 缺少 manifest.json");
const sourceManifestBytes = fs.readFileSync(sourceManifestPath);
const sourceManifestHash = sha256(sourceManifestBytes);
const sourceManifest = readJson(sourceManifestPath);
const sourceExportId = requireString(sourceManifest, "exportId");

const candidateListing = contentListing(args["candidate-files"]);
const requiredFiles = [
  "report-data.candidate.json",
  "model-decision-record.md",
  "model-observations.md",
  "research-report.md",
  "federation-report.md",
];
if (candidateListing.length !== requiredFiles.length)
  throw new Error("candidate 目录只能包含 report-data、两份模型材料和两份候选报告");
for (const required of requiredFiles) {
  const matches = candidateListing.filter((file) => file.path === required);
  if (matches.length !== 1) throw new Error(`candidate 缺少或重复文件: ${required}`);
}

const candidateDataFile = candidateListing.find((file) => file.path === requiredFiles[0])!;
const candidateData = readJson(path.join(args["candidate-files"], candidateDataFile.path));
const forbiddenFinalFields = ["exportId", "manifestHash", "outcomeDigest", "r4EvidenceBundleHash"];
for (const field of forbiddenFinalFields)
  if (field in candidateData) throw new Error(`candidate report-data 禁止 final 字段: ${field}`);
const candidateRequired = [
  "schemaVersion",
  "artifactKind",
  "sourceExportId",
  "sourceManifestHash",
  "studyFreezeId",
  "populationDigest",
  "reviewFreezeHash",
  "reportLocalizationDraftHash",
  "modelDecisionHash",
  "modelObservationsHash",
  "createdFromCommit",
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
for (const field of candidateRequired)
  if (!(field in candidateData)) throw new Error(`candidate report-data 缺少字段: ${field}`);
if (candidateData.schemaVersion !== "report-data-candidate-v1")
  throw new Error("candidate report-data schemaVersion 必须是 report-data-candidate-v1");
if (candidateData.artifactKind !== "candidate")
  throw new Error("candidate report-data artifactKind 必须是 candidate");
assertCandidateReportData(candidateData);
if (candidateData.sourceExportId !== sourceExportId)
  throw new Error("candidate report-data sourceExportId 未绑定 source manifest");
if (candidateData.sourceManifestHash !== sourceManifestHash)
  throw new Error("candidate report-data sourceManifestHash 未绑定 source manifest");
const studyFreezeId = requireString(candidateData, "studyFreezeId");
const populationDigest = requireString(candidateData, "populationDigest", /^[a-f0-9]{64}$/);
const reportLocalizationDraftHash = requireString(
  candidateData,
  "reportLocalizationDraftHash",
  /^[a-f0-9]{64}$/,
);
const modelDecisionHash = requireString(candidateData, "modelDecisionHash", /^[a-f0-9]{64}$/);
const modelObservationsHash = requireString(
  candidateData,
  "modelObservationsHash",
  /^[a-f0-9]{64}$/,
);
const createdFromCommit = requireString(candidateData, "createdFromCommit", /^[a-f0-9]{40,64}$/);

const reviewFreezeFiles = contentListing(args["review-freeze"]);
const reviewFreezeHash = sha256(Buffer.from(canonicalize(reviewFreezeFiles)));
if (candidateData.reviewFreezeHash !== reviewFreezeHash)
  throw new Error("candidate report-data reviewFreezeHash 未绑定 review-freeze");
const localizationHash = sha256(fs.readFileSync(localizationPath));
if (reportLocalizationDraftHash !== localizationHash)
  throw new Error("candidate report-data reportLocalizationDraftHash 未绑定草稿");
const modelDecisionFile = candidateListing.find((file) => file.path === requiredFiles[1])!;
const modelObservationsFile = candidateListing.find((file) => file.path === requiredFiles[2])!;
if (modelDecisionHash !== modelDecisionFile.sha256)
  throw new Error("modelDecisionHash 与候选文件不一致");
if (modelObservationsHash !== modelObservationsFile.sha256)
  throw new Error("modelObservationsHash 与候选文件不一致");

const candidateDataHash = candidateDataFile.sha256;
const requiredReportSections = [
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
for (const reportName of requiredFiles.slice(3)) {
  const report = candidateListing.find((file) => file.path === reportName)!;
  const text = fs.readFileSync(path.join(args["candidate-files"], report.path), "utf8");
  if (!text.includes("REVIEW CANDIDATE — NOT FINAL"))
    throw new Error(`候选报告缺少固定水印: ${reportName}`);
  if (!text.includes(candidateDataHash))
    throw new Error(`候选报告未绑定 candidate report-data hash: ${reportName}`);
  for (const section of requiredReportSections)
    if (!text.includes(section)) throw new Error(`候选报告缺少章节「${section}」: ${reportName}`);
  if (/final export-id|final manifest|study_final|report-data-v1|r4EvidenceBundleHash/i.test(text))
    throw new Error(`候选报告出现 final 身份或 final schema: ${reportName}`);
}

const logicalRole: Record<string, string> = {
  "report-data.candidate.json": "report-data",
  "model-decision-record.md": "model-decision",
  "model-observations.md": "model-observations",
  "research-report.md": "research-report",
  "federation-report.md": "federation-report",
};
const logicalFiles = candidateListing.map((file) => ({
  role: logicalRole[file.path],
  bytes: file.bytes,
  sha256: file.sha256,
}));
const bundleId = sha256(
  canonicalize({
    schemaVersion: "candidate-bundle-v1",
    sourceExportId,
    sourceManifestHash,
    studyFreezeId,
    populationDigest,
    reviewFreezeHash,
    reportLocalizationDraftHash,
    modelDecisionHash,
    modelObservationsHash,
    createdFromCommit,
    files: logicalFiles,
  }),
);
const bundle = {
  schemaVersion: "candidate-bundle-v1",
  candidateBundleId: bundleId,
  sourceExportId,
  sourceManifestHash,
  studyFreezeId,
  populationDigest,
  reviewFreezeHash,
  reportLocalizationDraftHash,
  modelDecisionHash,
  modelObservationsHash,
  createdFromCommit,
  files: candidateListing.map((file) => ({
    path: `candidate/${file.path}`,
    bytes: file.bytes,
    sha256: file.sha256,
  })),
};
const bundleBytes = Buffer.from(`${canonicalize(bundle)}\n`);
const outputRoot = args["output-root"];
fs.mkdirSync(outputRoot, { recursive: true });
const destination = path.join(outputRoot, bundleId);
if (fs.existsSync(destination)) {
  const existingBundlePath = path.join(destination, "candidate-bundle.json");
  if (
    !fs.existsSync(existingBundlePath) ||
    !fs.readFileSync(existingBundlePath).equals(bundleBytes)
  )
    throw new Error("candidate bundle 已存在但字节不同，拒绝覆盖");
  console.log(
    JSON.stringify({ candidateBundleId: bundleId, path: destination, status: "reused" }, null, 2),
  );
  process.exit(0);
}

const temporary = fs.mkdtempSync(path.join(outputRoot, `.candidate-${bundleId.slice(0, 12)}-`));
try {
  const candidateRoot = path.join(temporary, "candidate");
  fs.mkdirSync(candidateRoot, { recursive: true });
  for (const file of candidateListing)
    fs.copyFileSync(
      path.join(args["candidate-files"], file.path),
      path.join(candidateRoot, file.path),
    );
  const inputsRoot = path.join(temporary, "inputs");
  fs.mkdirSync(inputsRoot, { recursive: true });
  fs.copyFileSync(sourceManifestPath, path.join(inputsRoot, "source-manifest.json"));
  fs.writeFileSync(path.join(inputsRoot, "review-freeze.sha256"), `${reviewFreezeHash}\n`);
  fs.writeFileSync(
    path.join(inputsRoot, "report-localization-draft.sha256"),
    `${localizationHash}\n`,
  );
  fs.writeFileSync(path.join(temporary, "candidate-bundle.json"), bundleBytes);
  fs.writeFileSync(
    path.join(temporary, "STATUS.txt"),
    "REVIEW CANDIDATE — NOT FINAL\nR4 通过前不得生成 study_final。\n",
  );
  for (const file of contentListing(temporary))
    fs.chmodSync(path.join(temporary, file.path), 0o444);
  fs.chmodSync(temporary, 0o555);
  fs.renameSync(temporary, destination);
} catch (error) {
  fs.rmSync(temporary, { recursive: true, force: true });
  throw error;
}
console.log(
  JSON.stringify(
    { candidateBundleId: bundleId, path: destination, status: "candidate_only" },
    null,
    2,
  ),
);
