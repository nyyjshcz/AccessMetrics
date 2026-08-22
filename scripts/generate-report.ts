import fs from "node:fs";
import path from "node:path";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
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

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function valueAt(value: unknown, key: string): unknown {
  return asRecord(value)[key];
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "N/A";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 0) ?? "N/A";
}

function cell(value: unknown): string {
  return display(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function scoreText(value: unknown): string {
  if (value === null || value === undefined) return "N/A";
  const score = asRecord(value);
  const exact = score.exact;
  const shown = score.display;
  if (exact !== undefined && shown !== undefined) return `${display(shown)}（${display(exact)}）`;
  return display(shown ?? exact ?? value);
}

function table(headers: string[], rows: unknown[][]): string {
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${headers.map((_, index) => cell(row[index])).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function list(values: unknown[]): string {
  return values.length ? values.map((value) => `- ${cell(value)}`).join("\n") : "- N/A";
}

function sortedEntries(value: unknown): Array<[string, unknown]> {
  return Object.entries(asRecord(value)).sort(([left], [right]) => left.localeCompare(right));
}

function renderSiteScoreRows(scores: JsonRecord, ranks: JsonRecord): unknown[][] {
  return Object.entries(scores)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([site, score]) => [
      site,
      scoreText(score),
      valueAt(score, "exactNumerator"),
      valueAt(score, "exactDenominator"),
      valueAt(ranks, site),
    ]);
}

function renderPrincipleRows(principles: JsonRecord): unknown[][] {
  return sortedEntries(principles).map(([principle, value]) => {
    const payload = asRecord(value);
    return [principle, payload.opportunityCount, scoreText(payload.score ?? value)];
  });
}

function renderCategoryRows(categories: JsonRecord): unknown[][] {
  return sortedEntries(categories).map(([category, value]) => {
    const payload = asRecord(value);
    const distribution = asRecord(payload.scoreDistribution);
    return [
      category,
      payload.siteCount,
      distribution.n,
      distribution.mean,
      distribution.median,
      distribution.q1,
      distribution.q3,
    ];
  });
}

function renderSensitivityRows(sensitivity: JsonRecord): unknown[][] {
  return ["A", "B", "C"].map((scenario) => {
    const payload = asRecord(sensitivity[scenario]);
    const scores = asRecord(payload.scores);
    return [
      scenario,
      JSON.stringify(payload.weights ?? {}, null, 0),
      payload.maxWeight,
      Object.entries(scores)
        .map(([site, score]) => `${site}: ${scoreText(score)}`)
        .join("；") || "N/A",
    ];
  });
}

function renderVersionRows(provenance: JsonRecord): unknown[][] {
  const versions = Array.isArray(provenance.versions) ? provenance.versions : [];
  return versions.map((version) => {
    const row = asRecord(version);
    return [row.scannerVersion, row.axeVersion, row.modelVersion];
  });
}

function copyChartAssets(data: ReportData, inputPath: string, outputRoot: string) {
  const inputRoot = path.dirname(inputPath);
  const charts = Array.isArray(data.charts) ? data.charts : [];
  return charts.map((value) => {
    const item = asRecord(value);
    const relative = item.path;
    if (typeof relative !== "string" || !/^(charts|tables)\/[^/]+$/.test(relative))
      throw new Error(`图表路径不安全: ${display(relative)}`);
    const source = path.resolve(inputRoot, relative);
    const destination = path.resolve(outputRoot, relative);
    if (!source.startsWith(`${inputRoot}${path.sep}`) || !fs.existsSync(source))
      throw new Error(`图表文件不存在: ${relative}`);
    const bytes = fs.readFileSync(source);
    if (item.sha256 !== sha256(bytes)) throw new Error(`图表 hash 不一致: ${relative}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    return { path: relative, sha256: sha256(bytes), kind: item.kind };
  });
}

function markdownToDocx(markdown: string): Array<Paragraph | Table> {
  const lines = markdown.split(/\r?\n/);
  const blocks: Array<Paragraph | Table> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const headingLevel =
        level === 1
          ? HeadingLevel.TITLE
          : level === 2
            ? HeadingLevel.HEADING_1
            : level === 3
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3;
      blocks.push(new Paragraph({ text: heading[2], heading: headingLevel }));
      index++;
      continue;
    }
    if (
      line.startsWith("| ") &&
      index + 1 < lines.length &&
      /^\|?\s*:?-{3,}/.test(lines[index + 1])
    ) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        const current = lines[index];
        if (!/^\|?\s*:?-{3,}/.test(current)) {
          rows.push(
            current
              .trim()
              .replace(/^\|/, "")
              .replace(/\|$/, "")
              .split("|")
              .map((value) => value.trim().replaceAll("\\|", "|")),
          );
        }
        index++;
      }
      if (rows.length) {
        blocks.push(
          new Table({
            rows: rows.map(
              (row, rowIndex) =>
                new TableRow({
                  tableHeader: rowIndex === 0,
                  children: row.map(
                    (value) =>
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun(value)] })],
                      }),
                  ),
                }),
            ),
          }),
        );
      }
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      blocks.push(new Paragraph({ text: line.replace(/^[-*]\s+/, ""), bullet: { level: 0 } }));
    } else if (line.startsWith("> ")) {
      blocks.push(
        new Paragraph({ children: [new TextRun({ text: line.slice(2), italics: true })] }),
      );
    } else {
      blocks.push(new Paragraph({ text: line }));
    }
    index++;
  }
  return blocks;
}

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
  const scores = asRecord(data.scores);
  const siteScores = asRecord(scores.siteScores ?? data.siteScores);
  const rank = asRecord(scores.rank ?? data.rank);
  const sample = asRecord(data.sampleSummary);
  const pageStatus = asRecord(data.pageStatusSummary);
  const frame = asRecord(data.frameCoverageSummary);
  const principleSummary = asRecord(data.principleSummary);
  const severity = asRecord(data.severitySummary);
  const manual = asRecord(data.manualValidation);
  const sensitivity = asRecord(data.sensitivity);
  const provenance = asRecord(data.provenance);
  const distribution = asRecord(scores.distribution);
  const categories = asRecord(scores.categoryComparison);
  const commonRules = Array.isArray(data.commonRules) ? data.commonRules : [];
  const limitations = Array.isArray(data.limitations) ? data.limitations : [];
  const overall = scores.overall;
  const versions = renderVersionRows(provenance);
  const chartItems = Array.isArray(data.charts) ? data.charts.map(asRecord) : [];
  const chartLinks = chartItems.length
    ? chartItems
        .map((item) => {
          const kind = item.kind === "png" ? "图表" : "数据表";
          const pathValue = display(item.path);
          return item.kind === "png"
            ? `![${kind}：${pathValue}](${pathValue})`
            : `- ${kind}： [${pathValue}](${pathValue})`;
        })
        .join("\n")
    : "- N/A";
  const identity =
    mode === "final"
      ? `- final export-id：\`${String(data.exportId ?? "MISSING")}\`\n- final manifest SHA-256：\`${String(data.manifestHash ?? "MISSING")}\``
      : `- source export-id：\`${String(data.sourceExportId ?? "MISSING")}\`\n- source manifest SHA-256：\`${String(data.sourceManifestHash ?? "MISSING")}\`\n- review-freeze SHA-256：\`${String(data.reviewFreezeHash ?? "MISSING")}\``;
  const banner =
    mode === "candidate"
      ? "> REVIEW CANDIDATE — NOT FINAL\n\n"
      : "> 最终报告，由通过 R4/R5 门的冻结结构化数据生成。\n\n";
  const scoreRows = renderSiteScoreRows(siteScores, rank);
  const principleRows = renderPrincipleRows(principleSummary);
  const categoryRows = renderCategoryRows(categories);
  const sensitivityRows = renderSensitivityRows(sensitivity);
  const commonRuleRows = commonRules.map((item) => {
    const row = asRecord(item);
    return [row.ruleId, row.count];
  });
  const severityRows = sortedEntries(severity).map(([impact, count]) => [impact, count]);
  const statusRows = sortedEntries(pageStatus.runsByStatus).map(([status, count]) => [
    status,
    count,
  ]);
  const localizationRows = [
    ["scanTimeLocalizationHash", data.scanTimeLocalizationHash],
    ["reportLocalizationHash", data.reportLocalizationHash],
    ["populationDigest", data.populationDigest],
    ["outcomeDigest", data.outcomeDigest],
    ["reviewFreezeHash", data.reviewFreezeHash],
    ["modelDecisionHash", data.modelDecisionHash],
    ["modelObservationsHash", data.modelObservationsHash],
    ["r4EvidenceBundleHash", data.r4EvidenceBundleHash],
  ];
  const summaryText =
    kind === "research"
      ? "本报告把已验证导出的自动检测结果整理为可复核的研究资料，不把自动结果扩大解释为完整人工审计或全市总体估计。"
      : "本报告用较通俗的方式说明各站点自动检测结果、常见问题和后续改进入口；它不是官方认证，也不是完整人工审计。";
  const conclusion =
    mode === "candidate"
      ? "本候选版只供 R4 人工核对，不是最终成果，不得写入 final export；所有结论仍以绑定的冻结证据为准。"
      : "本节仅由通过 R4/R5 门的真实冻结数据生成；执行 AI 不代填单位、姓名、日期或接收状态。";
  return `# ${title}\n\n${banner}## 摘要\n\n${summaryText}\n\n${table(
    ["指标", "值"],
    [
      ["站点数", sample.siteCount],
      ["运行数", sample.runCount],
      ["页面数", sample.pageCount],
      ["成功页面数", sample.successPageCount],
      ["人工样本总体", sample.populationSize],
      ["人工样本目标数", sample.targetSize],
      ["自动总体分数", scoreText(overall)],
    ],
  )}\n\n## 数据绑定\n\n- report-data SHA-256：\`${reportDataHash}\`\n${identity}\n- 生成状态：\`${mode}\`\n- 本报告不得脱离对应研究冻结、源清单和人工门证据单独引用。\n\n## 1. 研究背景与问题\n\n项目关注公开网页中可以由 axe-core 自动判断的无障碍检查机会，并将扫描证据、评分、人工抽样和版本信息放在同一条可追溯链上。正式样本的纳入理由、许可和类别定义必须来自冻结的研究协议与样本框。\n\n## 2. 自动检测边界与研究范围\n\n自动结果只覆盖当前 viewport、当前页面状态和 axe-core 能够判断的规则；人工判断项目、未执行的 frame、动态登录后内容和其他未覆盖状态不能由自动分数代替。\n\n## 3. 样本站点选择原则\n\n正式报告应以冻结 sample-frame 与 campaign plan 为准，保留每个类别的定义、主站、替补、纳入/排除理由和公开依据。当前报告只引用 report-data 中的聚合统计，不在缺少正式样本时把 fixture 当作丽水样本。\n\n${table(["类别", "站点数", "有效分数数", "均值", "中位数", "Q1", "Q3"], categoryRows.length ? categoryRows : [["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]])}\n\n## 4. Playwright/axe-core 扫描方法\n\n扫描器使用 Playwright 生命周期、固定配置快照、同站页面发现和 axe-core 四类结果；页面、规则、节点、frame 覆盖及结构化失败都会写入导出。\n\n${table(["扫描器版本", "axe-core 版本", "评分模型版本"], versions.length ? versions : [["N/A", "N/A", "N/A"]])}\n\n## 5. axe 严重程度、WCAG 映射和评分公式\n\n规则目录保存规则 ID、impact 来源、WCAG 成功标准、等级、四项原则和评分资格。节点分数优先使用节点 impact，其次使用规则 impact；两者均缺失时才回退到固定配置权重并标记来源。incomplete 不进入自动分母；展示分数按固定 half-up 规则保留一位小数，精确 numerator/denominator 与展示值同时保留。\n\n## 6. 数据质量与失败页面处理\n\n${table(["运行状态", "数量"], statusRows.length ? statusRows : [["N/A", "N/A"]])}\n\n${table(
    ["frame 指标", "数量"],
    [
      ["总 frame", frame.frameTotal],
      ["已测试", frame.tested],
      ["跳过", frame.skipped],
      ["错误", frame.errors],
      ["覆盖受限页面", frame.limitedPages],
    ],
  )}\n\n成功、失败和部分成功运行会分开统计；不能因为某些页面成功就宣称整个站点或总体完整通过。\n\n## 7. 描述统计和四原则结果\n\n### 7.1 站点分数\n\n${table(["站点", "分数（展示/精确）", "精确分子", "精确分母", "排名"], scoreRows.length ? scoreRows : [["N/A", "N/A", "N/A", "N/A", "N/A"]])}\n\n### 7.2 四项原则\n\n${table(["原则", "机会数", "分数（展示/精确）"], principleRows.length ? principleRows : [["N/A", "N/A", "N/A"]])}\n\n### 7.3 总分分布\n\n${table(["统计量", "值"], Object.entries(distribution).length ? Object.entries(distribution).map(([key, value]) => [key, value]) : [["N/A", "N/A"]])}\n\n### 7.4 严重程度\n\n${table(["严重程度", "节点数"], severityRows.length ? severityRows : [["N/A", "N/A"]])}\n\n### 7.5 常见规则\n\n${table(["规则", "节点数"], commonRuleRows.length ? commonRuleRows : [["N/A", "N/A"]])}\n\n## 8. 敏感性分析\n\n三套预注册严重度权重只用于敏感性比较；排名和相关系数使用未舍入精确值，不能把敏感性结果写成因果结论。\n\n${table(["方案", "权重", "最大权重", "站点分数"], sensitivityRows.length ? sensitivityRows : [["N/A", "N/A", "N/A", "N/A"]])}\n\nSpearman 相关： ${cell(valueAt(sensitivity.spearman, "correlations"))}；共同站点数： ${display(valueAt(sensitivity.spearman, "commonSiteCount"))}。\n\n## 9. 已知问题 fixture 与人工抽查验证\n\nfixture 用于验证规则 ID、通过/失败节点、frame 覆盖、网络错误和评分边界，不属于正式研究总体。人工抽查仅解释实际抽样，不外推为 axe 总体准确率或全市估计。\n\n${table(
    ["人工指标", "值"],
    [
      ["抽样算法", manual.samplerVersion],
      ["总体大小", manual.populationSize],
      ["目标数", manual.targetSize],
      ["confirmed", manual.confirmedCount],
      ["not_an_issue", manual.notAnIssueCount],
      ["uncertain", manual.uncertainCount],
      ["一致数", manual.agreementCount],
      ["分歧数", manual.disagreementCount],
      ["一致率", manual.agreementRate],
      ["Cohen's kappa", manual.kappa],
      ["kappa 无值原因", manual.kappaNullReason],
      ["解释范围", manual.interpretationScope],
    ],
  )}\n\n## 10. 图表与数据表\n\n图表必须有相邻的可复制数据表；以下路径相对于本报告目录，并在 report manifest 中记录字节 hash。\n\n${chartLinks}\n\n## 11. 局限\n\n${list(
    [
      ...limitations,
      "单 viewport、当前渲染状态和未执行 frame 的边界必须结合 frameCoverageSummary 阅读。",
      "目的性样本和非等概率人工抽样不支持全市总体外推。",
      "自动评分不等同于完整人工审计、官方 WCAG 合规认证或总体准确率。",
    ],
  )}\n\n## 12. 结论\n\n${conclusion}\n\n## 13. 参考资料\n\n- W3C Web Content Accessibility Guidelines (WCAG) 2.2：<https://www.w3.org/TR/WCAG22/>\n- axe-core 项目与规则说明：<https://github.com/dequelabs/axe-core>\n- 本项目冻结的 WCAG 黄金快照、axe 目录、评分模型和导出 manifest。\n\n## 14. 两人分工与贡献说明\n\n计算机负责人负责软件、扫描安全、数据管线、导出与复现；数学/数据负责人负责评分公式、预注册模型、统计解释、敏感性分析和人工复核。姓名、日期和正式签署只由真人根据事实填写。\n\n## 15. 附录：版本、配置和复现方法\n\n${table(
    ["字段", "值"],
    [
      ["analysisVersion", provenance.analysisVersion],
      ["codeCommit", provenance.codeCommit],
      ["generatedAt", data.generatedAt],
      ["exportId", data.exportId],
      ["sourceExportId", data.sourceExportId],
      ["manifestHash", data.manifestHash],
      ...localizationRows,
    ],
  )}\n\n计算键：\n\n${list(Object.entries(asRecord(provenance.calculationKeys)).map(([key, value]) => `${key}: ${value}`))}\n\n复现命令：先校验 manifest 与 manifest.sha256，再运行 \`pnpm analysis:run -- <verified-export-directory>\`，最后用对应模式的报告生成器。\n`;
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
  const copiedCharts = copyChartAssets(data, options.input, output);
  const markdownPath = path.join(output, `${options.kind}-report.md`);
  const markdown = makeMarkdown(options.kind, mode, data, reportDataHash);
  fs.writeFileSync(markdownPath, markdown);
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
    files: [
      { path: path.basename(markdownPath), sha256: sha256(fs.readFileSync(markdownPath)) },
      ...copiedCharts,
    ],
  };
  if (options.docx !== undefined) {
    const doc = new Document({
      sections: [
        {
          children: markdownToDocx(markdown),
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
