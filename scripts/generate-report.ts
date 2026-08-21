import fs from "node:fs";
import path from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { assertCandidateReportData } from "./report-data-contract";

type ReportData = {
  siteScores?: Record<string, { exact?: string; display?: number | null }>;
  rank?: Record<string, number>;
  scores?: {
    siteScores?: Record<string, { exact?: string; display?: number | null }>;
    rank?: Record<string, number>;
  };
  [key: string]: unknown;
};

type ReportMode = "candidate" | "final";

const REQUIRED_REPORT_DATA_FIELDS = [
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
] as const;

function assertReportData(data: ReportData) {
  if (data.schemaVersion !== "report-data-v1")
    throw new Error("report-data schemaVersion 必须是 report-data-v1");
  const missing = REQUIRED_REPORT_DATA_FIELDS.filter((field) => !(field in data));
  if (missing.length) throw new Error(`report-data 缺少追溯字段: ${missing.join(", ")}`);
  if (!data.scores || typeof data.scores !== "object")
    throw new Error("report-data.scores 必须是对象");
  if (!data.manualValidation || typeof data.manualValidation !== "object")
    throw new Error("report-data.manualValidation 必须是对象");
}

function args() {
  const result: Record<string, string> = {};
  for (let index = 2; index < process.argv.length; index++) {
    if (process.argv[index] === "--" || !process.argv[index].startsWith("--")) continue;
    const key = process.argv[index].slice(2);
    result[key] = process.argv[index + 1] ?? "";
    index++;
  }
  return result;
}

function makeMarkdown(
  kind: "research" | "federation",
  mode: ReportMode,
  data: ReportData,
  reportDataHash: string,
) {
  const title =
    kind === "research"
      ? "AccessCheck Lishui 研究报告"
      : "丽水市公共数字服务信息无障碍自动评估报告";
  const siteScores = data.scores?.siteScores ?? data.siteScores ?? {};
  const rank = data.scores?.rank ?? data.rank ?? {};
  const rows = Object.entries(siteScores)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([site, score]) =>
        `| ${site} | ${score.exact ?? "N/A"} | ${score.display ?? "N/A"} | ${rank[site] ?? "N/A"} |`,
    )
    .join("\n");
  const identity =
    mode === "final"
      ? `- final export-id：\`${String(data.exportId ?? "MISSING")}\`\n- final manifest SHA-256：\`${String(data.manifestHash ?? "MISSING")}\``
      : `- source export-id：\`${String(data.sourceExportId ?? "MISSING")}\`\n- source manifest SHA-256：\`${String(data.sourceManifestHash ?? "MISSING")}\`\n- review-freeze SHA-256：\`${String(data.reviewFreezeHash ?? "MISSING")}\``;
  const banner =
    mode === "candidate"
      ? "> REVIEW CANDIDATE — NOT FINAL\n\n"
      : "> 最终报告，由通过 R4/R5 门的冻结结构化数据生成。\n\n";
  return `# ${title}\n\n${banner}## 重要边界\n\n本项目仅评价 axe-core 能够自动判断的网页无障碍检查项。分数不等同于完整人工审计、官方 WCAG 合规认证或“符合 WCAG 的百分比”。需要人工判断的项目会单独列出。\n\n## 数据绑定\n\n- report-data SHA-256：\`${reportDataHash}\`\n${identity}\n- 生成状态：\`${mode}\`\n- 本报告不得脱离对应研究冻结、源清单和人工门证据单独引用。\n\n## 站点分数\n\n| 站点 | 精确分数 | 展示分数 | 排名 |\n|---|---:|---:|---:|\n${rows || "| （冻结数据未提供站点） | N/A | N/A | N/A |"}\n\n## 方法与局限\n\n评分、四项原则、问题严重程度、人工抽查、失败页面和敏感性分析均以冻结导出和对应版本快照为准。没有真实冻结数据时，生成器拒绝把模板或 fixture 当作正式结论。\n\n## 结论\n\n${mode === "candidate" ? "本候选版只供 R4 人工核对，不是最终成果，不得写入 final export。" : "本节仅在 R4/R5 门通过后由真实数据生成；执行 AI 不代填单位、姓名、日期或接收状态。"}\n`;
  return `# ${title}\n\n${banner}## 重要边界\n\n本项目仅评价 axe-core 能够自动判断的网页无障碍检查项。分数不等同于完整人工审计、官方 WCAG 合规认证或“符合 WCAG 的百分比”。需要人工判断的项目会单独列出。\n\n## 数据绑定\n\n- report-data SHA-256：\`${reportDataHash}\`\n${identity}\n- 生成状态：\`${mode}\`\n- 本报告不得脱离对应研究冻结、源清单和人工门证据单独引用。\n\n## 站点分数\n\n| 站点 | 精确分数 | 展示分数 | 排名 |\n|---|---:|---:|---:|\n${rows || "| （冻结数据未提供站点） | N/A | N/A | N/A |"}\n\n## 方法与局限\n\n评分、四项原则、问题严重程度、人工抽查、失败页面和敏感性分析均以冻结导出和对应版本快照为准。没有真实冻结数据时，生成器拒绝把模板或 fixture 当作正式结论。\n\n## 结论\n\n${mode === "candidate" ? "本候选版只供 R4 人工核对，不是最终成果，不得写入 final export。" : "本节仅在 R4/R5 门通过后由真实数据生成；执行 AI 不代填单位、姓名、日期或接收状态。"}\n`;
}

async function main() {
  const options = args();
  if (process.argv.includes("--help")) {
    console.log(
      "usage: pnpm generate-report -- --input <absolute-report-data.json> --output-root <absolute-dir> --kind research|federation [--mode candidate|final] [--docx]",
    );
    return;
  }
  if (!options.input || !options["output-root"] || !options.kind)
    throw new Error("需要 --input、--output-root、--kind");
  if (!path.isAbsolute(options.input) || !path.isAbsolute(options["output-root"]))
    throw new Error("input/output-root 必须是绝对路径");
  if (!(options.kind === "research" || options.kind === "federation"))
    throw new Error("kind 必须是 research 或 federation");
  const mode = options.mode ?? "candidate";
  if (mode !== "candidate" && mode !== "final") throw new Error("mode 必须是 candidate 或 final");
  if (!fs.existsSync(options.input)) throw new Error("report-data 文件不存在");
  const data = JSON.parse(fs.readFileSync(options.input, "utf8")) as ReportData;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("report-data 必须是对象");
  if (mode === "final") assertReportData(data);
  else assertCandidateReportData(data);
  if (mode === "final") {
    if (!options["evidence-root"] || !path.isAbsolute(options["evidence-root"]))
      throw new Error("final 模式需要绝对 --evidence-root");
    if (!fs.existsSync(path.join(options["evidence-root"], "deliverables", "R4-PASSED")))
      throw new Error("R4 未通过，拒绝生成 final report");
  }
  const bytes = fs.readFileSync(options.input);
  const reportDataHash = sha256(bytes);
  const output = path.join(options["output-root"], mode, options.kind);
  fs.mkdirSync(output, { recursive: true });
  const markdownPath = path.join(output, `${options.kind}-report.md`);
  fs.writeFileSync(markdownPath, makeMarkdown(options.kind, mode, data, reportDataHash));
  const manifest: {
    schemaVersion: string;
    kind: string;
    mode: string;
    reportDataHash: string;
    files: Array<{ path: string; sha256: string }>;
  } = {
    schemaVersion: "report-artifact-v1",
    kind: options.kind,
    mode,
    reportDataHash,
    files: [{ path: path.basename(markdownPath), sha256: sha256(fs.readFileSync(markdownPath)) }],
  };
  if (options.docx !== undefined) {
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text:
                options.kind === "research"
                  ? "AccessCheck Lishui 研究报告"
                  : "丽水市公共数字服务信息无障碍自动评估报告",
              heading: HeadingLevel.TITLE,
            }),
            ...markdown
              .split("\n")
              .slice(2)
              .map((line) => new Paragraph({ children: [new TextRun(line)] })),
          ],
        },
      ],
    });
    const docxBytes = await Packer.toBuffer(doc);
    const docxPath = path.join(output, `${options.kind}-report.docx`);
    fs.writeFileSync(docxPath, docxBytes);
    manifest.files.push({ path: path.basename(docxPath), sha256: sha256(docxBytes) });
  }
  const manifestPath = path.join(output, "report-manifest.json");
  fs.writeFileSync(manifestPath, `${canonicalize(manifest)}\n`);
  console.log(
    JSON.stringify(
      {
        status: mode === "final" ? "final_candidate_generated" : "candidate_generated",
        output,
        reportDataHash,
        manifest: manifestPath,
      },
      null,
      2,
    ),
  );
}

void main();
