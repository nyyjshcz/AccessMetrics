import fs from "node:fs";
import path from "node:path";
import { getDb, transaction } from "./db";
import { config } from "./config";
import { canonicalize, sha256 } from "./canonical";
import { exportRun } from "./export";
import { AppError } from "./errors";
import {
  aiConfigForBatch,
  aiEvidenceRowsForBatch,
  aiReviewRowsForBatch,
  formalBatchForStudy,
  getAiBatch,
  loadAiOverlayForBatch,
} from "./ai-overlay";
import { buildRunScore, serializeRunScore } from "./run-score";
import { SCORE_MODEL_VERSION } from "./score";

export type ExportKind = "study_source" | "study_final" | "study_final_ai";

const CSV_TABLES = {
  "sites.csv": ["id", "origin", "name", "category", "created_at", "updated_at", "status"],
  "runs.csv": [
    "id",
    "job_id",
    "site_id",
    "scanner_version",
    "axe_version",
    "catalog_version",
    "score_model_version",
    "rule_catalog_hash",
    "config_snapshot_json",
    "viewport_json",
    "user_agent",
    "scan_time_localization_hash",
    "started_at",
    "finished_at",
    "created_at",
    "status",
    "page_count",
    "success_count",
    "failed_count",
    "score_json",
    "export_id",
    "manifest_hash",
  ],
  "pages.csv": [
    "id",
    "site_id",
    "run_id",
    "job_page_id",
    "requested_url",
    "final_url",
    "canonical_url",
    "normalized_url",
    "crawl_depth",
    "discovered_from_url",
    "http_status",
    "content_type",
    "load_ms",
    "scan_status",
    "error_code",
    "error_message",
    "title",
    "frame_total",
    "same_origin_frame_total",
    "cross_origin_frame_total",
    "frame_tested_total",
    "frame_skipped_total",
    "frame_error_count",
    "frame_coverage_status",
    "frame_coverage_issues_json",
    "axe_timestamp",
    "axe_test_engine_json",
    "axe_test_environment_json",
    "axe_tool_options_json",
    "created_at",
  ],
  "rule_results.csv": [
    "id",
    "run_id",
    "page_id",
    "rule_id",
    "result_type",
    "impact",
    "description",
    "help",
    "help_url",
    "tags_json",
    "wcag_criteria_json",
    "principles_json",
    "wcag_level_json",
    "scoring_eligible",
    "node_count",
    "raw_json",
    "created_at",
  ],
  "result_nodes.csv": [
    "id",
    "rule_result_id",
    "ordinal",
    "frame_path_json",
    "frame_url",
    "frame_origin_relation",
    "target_json",
    "target_hash",
    "impact",
    "effective_impact",
    "severity_weight",
    "severity_source",
    "html_excerpt",
    "html_sanitized",
    "failure_summary",
    "any_json",
    "all_json",
    "none_json",
    "checks_json",
    "created_at",
  ],
  "page_scores.csv": [
    "id",
    "run_id",
    "page_id",
    "perceivable_num",
    "perceivable_den",
    "operable_num",
    "operable_den",
    "understandable_num",
    "understandable_den",
    "robust_num",
    "robust_den",
    "overall_num",
    "overall_den",
    "weighted_defects",
    "total_violations",
    "model_version",
    "total_score",
    "total_score_tenths",
    "total_numerator",
    "total_denominator",
    "perceivable_score",
    "perceivable_score_tenths",
    "perceivable_numerator",
    "perceivable_denominator",
    "operable_score",
    "operable_score_tenths",
    "operable_numerator",
    "operable_denominator",
    "understandable_score",
    "understandable_score_tenths",
    "understandable_numerator",
    "understandable_denominator",
    "robust_score",
    "robust_score_tenths",
    "robust_numerator",
    "robust_denominator",
    "score_details_json",
    "created_at",
  ],
  "site_scores.csv": [
    "id",
    "run_id",
    "perceivable_num",
    "perceivable_den",
    "operable_num",
    "operable_den",
    "understandable_num",
    "understandable_den",
    "robust_num",
    "robust_den",
    "overall_num",
    "overall_den",
    "page_count",
    "model_version",
    "total_score",
    "total_score_tenths",
    "total_numerator",
    "total_denominator",
    "perceivable_score",
    "perceivable_score_tenths",
    "perceivable_numerator",
    "perceivable_denominator",
    "operable_score",
    "operable_score_tenths",
    "operable_numerator",
    "operable_denominator",
    "understandable_score",
    "understandable_score_tenths",
    "understandable_numerator",
    "understandable_denominator",
    "robust_score",
    "robust_score_tenths",
    "robust_numerator",
    "robust_denominator",
    "score_details_json",
    "created_at",
  ],
  "manual_review_batches.csv": [
    "id",
    "study_freeze_id",
    "source_export_id",
    "source_manifest_hash",
    "population_digest",
    "algorithm_version",
    "seed",
    "target_size",
    "population_size",
    "strata_config_json",
    "status",
    "created_at",
    "completed_at",
  ],
  "manual_review_samples.csv": [
    "id",
    "batch_id",
    "result_node_id",
    "result_type",
    "effective_impact",
    "rule_id",
    "stratum",
    "draw_order",
    "selected_at",
  ],
  "manual_reviews.csv": [
    "id",
    "result_node_id",
    "sample_id",
    "review_context",
    "reviewer",
    "verdict",
    "note",
    "revision",
    "supersedes_review_id",
    "is_current",
    "reviewed_at",
  ],
  "manual_review_adjudications.csv": [
    "id",
    "sample_id",
    "adjudicated_verdict",
    "resolution_note",
    "resolution_hash",
    "revision",
    "supersedes_adjudication_id",
    "status",
    "proposed_by",
    "approved_by",
    "proposed_at",
    "approved_at",
    "is_current",
  ],
  "job_pages.csv": [
    "job_id",
    "page_id",
    "discovery_order",
    "status",
    "attempts",
    "attempt_count",
    "lease_owner",
    "lease_until",
    "lease_expires_at",
    "last_error",
    "last_error_code",
    "created_at",
    "updated_at",
  ],
} as const;

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function canonicalJsonCell(value: unknown) {
  if (typeof value !== "string" || !/^(?:\{|\[)/.test(value.trim())) return value;
  try {
    return canonicalize(JSON.parse(value));
  } catch {
    return value;
  }
}

function writeCsv(file: string, columns: readonly string[], rows: any[]) {
  const lines = [columns.join(",")];
  for (const row of rows)
    lines.push(columns.map((column) => csvCell(canonicalJsonCell(row[column]))).join(","));
  const bytes = Buffer.concat([
    Buffer.from("\uFEFF", "utf8"),
    Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8"),
  ]);
  fs.writeFileSync(file, bytes);
  return bytes;
}

function walkDirectories(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(full, ...walkDirectories(full));
  }
  return result;
}

function walkFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(full));
    else result.push(full);
  }
  return result;
}

function readonlyTree(root: string) {
  for (const directory of [root, ...walkDirectories(root)]) fs.chmodSync(directory, 0o555);
  for (const file of walkFiles(root)) fs.chmodSync(file, 0o444);
}

function findArtifactByHash(expectedHash: string, allowedNames: Set<string>): string {
  const root = config.privateEvidenceRoot;
  if (!fs.existsSync(root))
    throw new AppError("FINAL_ARTIFACT_MISSING", "R4 私有证据根不存在", 409);
  const matches: string[] = [];
  for (const file of walkFiles(root)) {
    if (!allowedNames.has(path.basename(file))) continue;
    if (sha256(fs.readFileSync(file)) === expectedHash) matches.push(file);
  }
  if (matches.length !== 1)
    throw new AppError(
      "FINAL_ARTIFACT_HASH_MISMATCH",
      `R4 冻结材料不存在或匹配不唯一: ${[...allowedNames].join(", ")}`,
      409,
    );
  return matches[0];
}

function parseCsv(bytes: Buffer, filename: string): string[][] {
  if (!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
    throw new AppError("CSV_ENCODING_INVALID", `${filename} 必须是 UTF-8 BOM`, 500);
  const text = bytes.subarray(3).toString("utf8");
  if (!text.endsWith("\r\n") || (text.includes("\n") && text.replaceAll("\r\n", "").includes("\n")))
    throw new AppError("CSV_LINE_ENDING_INVALID", `${filename} 必须使用 CRLF`, 500);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index++;
    } else cell += char;
  }
  if (quoted || row.length || cell)
    throw new AppError("CSV_PARSE_INVALID", `${filename} 无法解析`, 500);
  return rows;
}

function validateStudyPayload(target: string, kind: ExportKind, exportId: string) {
  const contract = JSON.parse(
    fs.readFileSync(path.join(target, "schemas", "study-csv-columns.v1.json"), "utf8"),
  ) as { tables?: Record<string, { columns?: string[] }> };
  const csvIds = new Map<string, Set<string>>();
  for (const [filename, columns] of Object.entries(CSV_TABLES)) {
    const rows = parseCsv(fs.readFileSync(path.join(target, "data", filename)), filename);
    if (JSON.stringify(rows[0] ?? []) !== JSON.stringify(columns))
      throw new AppError("CSV_HEADER_INVALID", `${filename} 列顺序不符合契约`, 500);
    if (JSON.stringify(contract.tables?.[filename]?.columns) !== JSON.stringify(columns))
      throw new AppError("CSV_CONTRACT_MISMATCH", `${filename} schema 与导出不一致`, 500);
    csvIds.set(
      filename,
      new Set(
        rows
          .slice(1)
          .map((row) => row[0])
          .filter(Boolean),
      ),
    );
  }
  const runs = csvIds.get("runs.csv")!;
  const pages = csvIds.get("pages.csv")!;
  const rules = csvIds.get("rule_results.csv")!;
  const nodes = csvIds.get("result_nodes.csv")!;
  const samples = csvIds.get("manual_review_samples.csv")!;
  for (const row of parseCsv(
    fs.readFileSync(path.join(target, "data", "pages.csv")),
    "pages.csv",
  ).slice(1))
    if (!runs.has(row[2]))
      throw new AppError("CSV_FOREIGN_KEY_INVALID", "pages.run_id 不存在", 500);
  for (const row of parseCsv(
    fs.readFileSync(path.join(target, "data", "rule_results.csv")),
    "rule_results.csv",
  ).slice(1))
    if (!runs.has(row[1]) || !pages.has(row[2]))
      throw new AppError("CSV_FOREIGN_KEY_INVALID", "rule_results 外键不存在", 500);
  for (const row of parseCsv(
    fs.readFileSync(path.join(target, "data", "result_nodes.csv")),
    "result_nodes.csv",
  ).slice(1))
    if (!rules.has(row[1]))
      throw new AppError("CSV_FOREIGN_KEY_INVALID", "result_nodes.rule_result_id 不存在", 500);
  for (const row of parseCsv(
    fs.readFileSync(path.join(target, "data", "manual_review_samples.csv")),
    "manual_review_samples.csv",
  ).slice(1))
    if (!nodes.has(row[2]))
      throw new AppError(
        "CSV_FOREIGN_KEY_INVALID",
        "manual_review_samples.result_node_id 不存在",
        500,
      );
  for (const row of parseCsv(
    fs.readFileSync(path.join(target, "data", "manual_reviews.csv")),
    "manual_reviews.csv",
  ).slice(1))
    if (!nodes.has(row[1]) || (row[2] && !samples.has(row[2])))
      throw new AppError("CSV_FOREIGN_KEY_INVALID", "manual_reviews 外键不存在", 500);
  const study = JSON.parse(
    fs.readFileSync(path.join(target, "data", "study.json"), "utf8"),
  ) as Record<string, unknown>;
  if (
    study.schemaVersion !== "study-export-v1" ||
    study.exportId !== exportId ||
    study.exportKind !== kind ||
    typeof study.studyFreezeId !== "string" ||
    !Array.isArray(study.runSet) ||
    (study.runSet as unknown[]).some((value) => typeof value !== "string")
  )
    throw new AppError("STUDY_SCHEMA_INVALID", "data/study.json 不符合固定 schema", 500);
  const listedRunIds = [...runs].sort();
  const studyRunIds = (study.runSet as string[]).slice().sort();
  if (JSON.stringify(listedRunIds) !== JSON.stringify(studyRunIds))
    throw new AppError("STUDY_RUN_SET_INVALID", "study.json runSet 与 runs.csv 不一致", 500);
}

function validateManifestDocument(target: string, kind: ExportKind, exportId: string) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(target, "manifest.json"), "utf8"),
  ) as Record<string, any>;
  if (
    manifest.schemaVersion !== "canonical-manifest-json-v1" ||
    manifest.exportId !== exportId ||
    manifest.exportKind !== kind ||
    manifest.kind !== kind ||
    !Array.isArray(manifest.files) ||
    !Number.isInteger(manifest.revision) ||
    manifest.revision < 1
  )
    throw new AppError("MANIFEST_SCHEMA_INVALID", "manifest.json 不符合固定 schema", 500);
  const paths = new Set(manifest.files.map((file: any) => file.path));
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !Number.isInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new AppError("MANIFEST_FILE_INVALID", "manifest.files 存在无效条目", 500);
  }
  if (kind === "study_source") {
    for (const field of [
      "sourceExportId",
      "sourceManifestHash",
      "outcomeDigest",
      "reviewFreezeHash",
      "reportLocalizationHash",
      "modelDecisionHash",
      "modelObservationsHash",
      "r4EvidenceBundleHash",
    ])
      if (manifest[field] !== null)
        throw new AppError("SOURCE_MANIFEST_CONTAMINATED", `study_source 不得包含 ${field}`, 500);
    if (
      [...paths].some(
        (value) => value.includes("report-localization") || value.startsWith("analysis/"),
      )
    )
      throw new AppError("SOURCE_MANIFEST_CONTAMINATED", "study_source 不得包含 final 材料", 500);
  } else if (kind === "study_final") {
    if (typeof manifest.sourceExportId !== "string" || !manifest.sourceExportId)
      throw new AppError("FINAL_MANIFEST_INCOMPLETE", "study_final 缺少 sourceExportId", 500);
    for (const field of [
      "sourceManifestHash",
      "outcomeDigest",
      "reviewFreezeHash",
      "reportLocalizationHash",
      "modelDecisionHash",
      "modelObservationsHash",
      "r4EvidenceBundleHash",
    ])
      if (typeof manifest[field] !== "string" || !/^[a-f0-9]{64}$/.test(manifest[field]))
        throw new AppError("FINAL_MANIFEST_INCOMPLETE", `study_final 缺少冻结字段 ${field}`, 500);
    if (
      !paths.has("configs/rule-localizations.report.zh-CN.json") ||
      !paths.has("analysis/model-decision-record.md") ||
      !paths.has("analysis/model-observations.md")
    )
      throw new AppError("FINAL_MANIFEST_INCOMPLETE", "study_final 缺少 R4 冻结材料", 500);
  } else if (kind === "study_final_ai") {
    if (typeof manifest.sourceExportId !== "string" || !manifest.sourceExportId)
      throw new AppError("AI_FINAL_MANIFEST_INCOMPLETE", "study_final_ai 缺少 sourceExportId", 500);
    for (const field of ["sourceManifestHash", "outcomeDigest"])
      if (typeof manifest[field] !== "string" || !/^[a-f0-9]{64}$/.test(manifest[field]))
        throw new AppError(
          "AI_FINAL_MANIFEST_INCOMPLETE",
          `study_final_ai 缺少冻结字段 ${field}`,
          500,
        );
    if (typeof manifest.aiBatchId !== "string" || !/^[A-Za-z0-9_-]+$/.test(manifest.aiBatchId))
      throw new AppError("AI_FINAL_MANIFEST_INCOMPLETE", "study_final_ai 缺少 aiBatchId", 500);
    for (const required of [
      "ai/reviews.csv",
      "ai/evidence.jsonl",
      "ai/summary.json",
      "ai/score.json",
      "ai/config.json",
    ])
      if (!paths.has(required))
        throw new AppError("AI_FINAL_MANIFEST_INCOMPLETE", `study_final_ai 缺少 ${required}`, 500);
  } else {
    throw new AppError("EXPORT_KIND_INVALID", `不支持的 study export kind: ${kind}`, 500);
  }
}

function canonicalRunsForFreeze(freeze: any) {
  const attempts = getDb()
    .prepare(
      "SELECT slot,run_id,usability_decision FROM study_run_attempts WHERE campaign_id=? ORDER BY slot,attempt_no",
    )
    .all(freeze.campaign_id) as Array<{
    slot: number;
    run_id: string | null;
    usability_decision: string;
  }>;
  const slots = [...new Set(attempts.map((attempt) => attempt.slot))].sort((a, b) => a - b);
  return slots.map((slot) => {
    const included = attempts.find(
      (attempt) => attempt.slot === slot && attempt.usability_decision === "included",
    );
    return { slot, runId: included?.run_id ?? null, status: included ? "included" : "failed" };
  });
}

function copyRunExports(target: string, runIds: string[]) {
  for (const runId of runIds) {
    const generated = exportRun(runId);
    const destination = path.join(target, "runs", runId);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ["scan.json", "issues.csv", "manifest.json", "manifest.sha256"])
      fs.copyFileSync(path.join(generated.target, file), path.join(destination, file));
    const scanPath = path.join(destination, "scan.json");
    const scan = JSON.parse(fs.readFileSync(scanPath, "utf8")) as Record<string, unknown>;
    // Nested run exports are immutable automatic evidence. Everyday notes and
    // formal double-review data live in separate, purpose-specific artifacts;
    // never let a note from either workflow bleed into a study export.
    scan.reviewRefs = [];
    const scanBytes = Buffer.from(`${canonicalize(scan)}\n`);
    fs.writeFileSync(scanPath, scanBytes);
    const nestedManifestPath = path.join(destination, "manifest.json");
    const nestedManifest = JSON.parse(fs.readFileSync(nestedManifestPath, "utf8")) as {
      files?: Array<{ path: string; size: number; sha256: string }>;
    };
    const scanEntry = nestedManifest.files?.find((entry) => entry.path === "scan.json");
    if (!scanEntry)
      throw new AppError("RUN_MANIFEST_INVALID", "run export manifest 缺少 scan.json", 500);
    scanEntry.size = scanBytes.length;
    scanEntry.sha256 = sha256(scanBytes);
    const nestedManifestBytes = Buffer.from(`${canonicalize(nestedManifest)}\n`);
    fs.writeFileSync(nestedManifestPath, nestedManifestBytes);
    fs.writeFileSync(path.join(destination, "manifest.sha256"), `${sha256(nestedManifestBytes)}\n`);
  }
}

function fileManifest(target: string) {
  const files = walkFiles(target)
    .filter((file) => !["manifest.json", "manifest.sha256"].includes(path.basename(file)))
    .map((file) => {
      const bytes = fs.readFileSync(file);
      return {
        path: path.relative(target, file).replaceAll(path.sep, "/"),
        size: bytes.length,
        sha256: sha256(bytes),
        ...(path.extname(file).toLowerCase() === ".csv"
          ? {
              rows: Math.max(
                0,
                bytes
                  .toString("utf8")
                  .replace(/^\uFEFF/, "")
                  .split("\r\n")
                  .filter((line) => line.length > 0).length - 1,
              ),
            }
          : {}),
      };
    });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function currentStudyExport(studyFreezeId: string, kind: ExportKind) {
  return getDb()
    .prepare(
      "SELECT * FROM study_exports WHERE study_freeze_id=? AND kind=? AND is_current=1 AND status='verified' ORDER BY revision DESC LIMIT 1",
    )
    .get(studyFreezeId, kind) as any;
}

function inClause(ids: string[]) {
  if (ids.length === 0) return "NULL";
  return ids.map(() => "?").join(",");
}

function queryStudyRows(runIds: string[], batchIds: string[]) {
  const db = getDb();
  const runs = db
    .prepare(`SELECT * FROM scan_runs WHERE id IN (${inClause(runIds)}) ORDER BY id`)
    .all(...runIds) as any[];
  const pages = db
    .prepare(
      `SELECT * FROM pages WHERE run_id IN (${inClause(runIds)}) ORDER BY run_id,canonical_url,id`,
    )
    .all(...runIds) as any[];
  const ruleResults = db
    .prepare(
      `SELECT * FROM rule_results WHERE run_id IN (${inClause(runIds)}) ORDER BY run_id,page_id,rule_id,result_type,id`,
    )
    .all(...runIds) as any[];
  const resultNodes = db
    .prepare(
      `SELECT n.* FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id
       WHERE rr.run_id IN (${inClause(runIds)}) ORDER BY rr.run_id,rr.page_id,rr.rule_id,rr.result_type,n.ordinal,n.id`,
    )
    .all(...runIds) as any[];
  const pageScores = db
    .prepare(
      `SELECT * FROM page_scores WHERE run_id IN (${inClause(runIds)}) ORDER BY run_id,page_id`,
    )
    .all(...runIds) as any[];
  const siteScores = db
    .prepare(`SELECT * FROM site_scores WHERE run_id IN (${inClause(runIds)}) ORDER BY run_id`)
    .all(...runIds) as any[];
  const jobs = db
    .prepare(
      `SELECT jp.* FROM job_pages jp JOIN scan_runs r ON r.job_id=jp.job_id
       WHERE r.id IN (${inClause(runIds)}) ORDER BY jp.job_id,jp.discovery_order,jp.page_id`,
    )
    .all(...runIds) as any[];
  const sites = db
    .prepare(
      `SELECT DISTINCT s.* FROM sites s JOIN scan_runs r ON r.site_id=s.id
       WHERE r.id IN (${inClause(runIds)}) ORDER BY s.id`,
    )
    .all(...runIds) as any[];
  const batches = batchIds.length
    ? (db
        .prepare(
          `SELECT * FROM manual_review_batches WHERE id IN (${inClause(batchIds)}) ORDER BY id`,
        )
        .all(...batchIds) as any[])
    : [];
  const samples = batchIds.length
    ? (db
        .prepare(
          `SELECT * FROM manual_review_samples WHERE batch_id IN (${inClause(batchIds)}) ORDER BY batch_id,draw_order`,
        )
        .all(...batchIds) as any[])
    : [];
  const sampleIds = samples.map((row) => String(row.id));
  const reviews = sampleIds.length
    ? (db
        .prepare(
          `SELECT * FROM manual_reviews WHERE sample_id IN (${inClause(sampleIds)}) AND review_context='formal' ORDER BY sample_id,reviewer,revision,id`,
        )
        .all(...sampleIds) as any[])
    : [];
  const adjudications = sampleIds.length
    ? (db
        .prepare(
          `SELECT * FROM manual_review_adjudications WHERE sample_id IN (${inClause(sampleIds)}) ORDER BY sample_id,revision,id`,
        )
        .all(...sampleIds) as any[])
    : [];
  return {
    sites,
    runs,
    pages,
    ruleResults,
    resultNodes,
    pageScores,
    siteScores,
    jobs,
    batches,
    samples,
    reviews,
    adjudications,
  };
}

function writeStudyPayload(
  target: string,
  runIds: string[],
  batchIds: string[],
  kind: ExportKind,
  freeze: any,
  exportId: string,
  outcomeDigest: string | null,
) {
  const csvContract = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "contracts", "study-csv-columns.v1.json"), "utf8"),
  ) as { tables?: Record<string, { columns?: string[] }> };
  for (const [filename, columns] of Object.entries(CSV_TABLES)) {
    if (JSON.stringify(csvContract.tables?.[filename]?.columns) !== JSON.stringify(columns))
      throw new AppError("CSV_CONTRACT_MISMATCH", `CSV 列契约与导出器不一致: ${filename}`, 500);
  }
  const rows = queryStudyRows(runIds, batchIds);
  const dataDir = path.join(target, "data");
  const schemaDir = path.join(target, "schemas");
  const configDir = path.join(target, "configs");
  const researchDir = path.join(target, "research");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(researchDir, { recursive: true });

  const csvRows: Record<string, any[]> = {
    "sites.csv": rows.sites,
    "runs.csv": rows.runs,
    "pages.csv": rows.pages,
    "rule_results.csv": rows.ruleResults,
    "result_nodes.csv": rows.resultNodes,
    "page_scores.csv": rows.pageScores,
    "site_scores.csv": rows.siteScores,
    "manual_review_batches.csv": kind === "study_final" ? rows.batches : [],
    "manual_review_samples.csv": kind === "study_final" ? rows.samples : [],
    "manual_reviews.csv": kind === "study_final" ? rows.reviews : [],
    "manual_review_adjudications.csv": kind === "study_final" ? rows.adjudications : [],
    "job_pages.csv": rows.jobs,
  };
  for (const [filename, columns] of Object.entries(CSV_TABLES))
    writeCsv(path.join(dataDir, filename), columns, csvRows[filename] ?? []);

  const studyJson = {
    schemaVersion: "study-export-v1",
    exportId,
    exportKind: kind,
    studyFreezeId: freeze.id,
    runSet: runIds,
    outcomeDigest,
  };
  fs.writeFileSync(path.join(dataDir, "study.json"), `${canonicalize(studyJson)}\n`);

  for (const filename of [
    "run-export.schema.json",
    "study-export.schema.json",
    "manifest.schema.json",
    "study-csv-columns.v1.json",
  ])
    fs.copyFileSync(
      path.join(process.cwd(), "contracts", filename),
      path.join(schemaDir, filename),
    );
  fs.copyFileSync(
    path.join(process.cwd(), "configs", "axe-rule-catalog.json"),
    path.join(configDir, "axe-rule-catalog.json"),
  );
  fs.copyFileSync(
    path.join(process.cwd(), "scoring", "wcag-criteria.v2.2.json"),
    path.join(configDir, "wcag-criteria.v2.2.json"),
  );
  fs.copyFileSync(
    path.join(process.cwd(), "scoring", "scoring-config.v1.json"),
    path.join(configDir, "scoring-config.v1.json"),
  );
  fs.copyFileSync(
    path.join(process.cwd(), "scoring", "rule-localizations.zh-CN.json"),
    path.join(configDir, "rule-localizations.scan-time.zh-CN.json"),
  );

  for (const filename of [
    "protocol.md",
    "sample-frame.csv",
    "campaign-plan.json",
    "inclusion-exclusion-log.csv",
  ])
    fs.copyFileSync(
      path.join(process.cwd(), "research", filename),
      path.join(researchDir, filename),
    );
  if (kind === "study_final") {
    if (!freeze.model_decision_hash || !freeze.model_observations_hash)
      throw new AppError("FINAL_ANALYSIS_MISSING", "study_final 缺少 R4 冻结的模型 hash", 409);
    const modelDecision = findArtifactByHash(
      freeze.model_decision_hash,
      new Set(["model-decision-record.md"]),
    );
    const modelObservations = findArtifactByHash(
      freeze.model_observations_hash,
      new Set(["model-observations.md"]),
    );
    fs.mkdirSync(path.join(target, "analysis"), { recursive: true });
    fs.copyFileSync(modelDecision, path.join(target, "analysis", "model-decision-record.md"));
    fs.copyFileSync(modelObservations, path.join(target, "analysis", "model-observations.md"));
    if (!freeze.report_localization_hash)
      throw new AppError(
        "REPORT_LOCALIZATION_MISSING",
        "study_final 缺少 R4 冻结的报告中文目录",
        409,
      );
    const reportLocalization = findArtifactByHash(
      freeze.report_localization_hash,
      new Set(["rule-localizations.report.zh-CN.json"]),
    );
    fs.copyFileSync(
      reportLocalization,
      path.join(configDir, "rule-localizations.report.zh-CN.json"),
    );
  }
  return rows;
}

function writeAiStudyArtifacts(target: string, batchId: string, runIds: string[]) {
  const aiDir = path.join(target, "ai");
  fs.mkdirSync(aiDir, { recursive: true });
  const rows = aiReviewRowsForBatch(batchId);
  const evidenceRows = aiEvidenceRowsForBatch(batchId);
  if (evidenceRows.some((row) => row.item_evidence_hash !== row.ai_evidence_hash))
    throw new AppError(
      "AI_EVIDENCE_CHANGED",
      "formal AI batch 引用的 evidence 已变化，不能导出",
      409,
    );
  const configSnapshot = aiConfigForBatch(batchId);
  const batch = getAiBatch(batchId);
  const overlay = loadAiOverlayForBatch(batchId);
  const score = {
    modelVersion: `${SCORE_MODEL_VERSION}+ai-overlay-v1`,
    runs: runIds.map((runId) => ({
      runId,
      original: serializeRunScore(buildRunScore(runId)),
      aiOverlay: serializeRunScore(buildRunScore(runId, { aiOverlay: overlay })),
    })),
  };
  const summary = {
    batchId,
    total_incomplete: batch.stats.total,
    problem_count: batch.stats.problem,
    not_problem_count: batch.stats.notProblem,
    uncertain_count: batch.stats.uncertain,
    failed_count: batch.stats.failed,
    processed_coverage: batch.stats.processedCoverage,
    resolution_coverage: batch.stats.resolutionCoverage,
  };
  const reviewColumns = [
    "result_node_id",
    "run_id",
    "page_id",
    "canonical_url",
    "rule_id",
    "status",
    "verdict",
    "reason",
    "evidence_hash",
    "attempt_count",
    "response_hash",
    "last_error",
    "created_at",
    "updated_at",
    "completed_at",
  ] as const;
  writeCsv(
    path.join(aiDir, "reviews.csv"),
    reviewColumns,
    rows.map((row) => ({
      result_node_id: row.result_node_id,
      run_id: row.run_id,
      page_id: row.page_id,
      canonical_url: row.canonical_url,
      rule_id: row.rule_id,
      status: row.status,
      verdict: row.verdict,
      reason: row.reason,
      evidence_hash: row.evidence_hash,
      attempt_count: row.attempt_count,
      response_hash: row.response_hash,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
    })),
  );
  const evidenceBytes = evidenceRows
    .map((row) =>
      canonicalize({
        resultNodeId: row.result_node_id,
        runId: row.run_id,
        pageId: row.page_id,
        ruleId: row.rule_id,
        verdict: row.verdict,
        reason: row.reason,
        evidenceHash: row.item_evidence_hash,
        evidenceVersion: row.ai_evidence_version,
        evidence: row.ai_evidence_json ? JSON.parse(row.ai_evidence_json) : null,
      }),
    )
    .join("\n");
  fs.writeFileSync(path.join(aiDir, "evidence.jsonl"), evidenceBytes ? `${evidenceBytes}\n` : "");
  fs.writeFileSync(path.join(aiDir, "summary.json"), `${canonicalize(summary)}\n`);
  fs.writeFileSync(path.join(aiDir, "score.json"), `${canonicalize(score)}\n`);
  fs.writeFileSync(
    path.join(aiDir, "config.json"),
    `${canonicalize({ batchId, batchKey: batch.batch.batch_key, ...configSnapshot })}\n`,
  );
  return { summary, configSnapshot, batch: batch.batch };
}

function verifyExpectedDigest(expected: string | null | undefined, actual: string | null) {
  if (expected !== undefined && expected !== null && expected !== actual)
    throw new AppError(
      "OUTCOME_DIGEST_MISMATCH",
      "expectedOutcomeDigest 与服务端重算值不一致",
      409,
    );
}

export function createStudyExport(input: {
  studyFreezeId: string;
  kind: ExportKind;
  expectedSourceExportId?: string | null;
  expectedOutcomeDigest?: string | null;
}) {
  const db = getDb();
  const freeze = db
    .prepare("SELECT * FROM study_freezes WHERE id=?")
    .get(input.studyFreezeId) as any;
  if (!freeze) throw new AppError("NOT_FOUND", "study freeze 不存在", 404);

  const existingSource = currentStudyExport(input.studyFreezeId, "study_source");
  if (input.kind === "study_source") {
    if (existingSource) {
      if (freeze.status === "registered")
        db.prepare(
          "UPDATE study_freezes SET status='source_verified' WHERE id=? AND status='registered'",
        ).run(input.studyFreezeId);
      return existingSource;
    }
    if (freeze.status !== "registered")
      throw new AppError("SOURCE_FREEZE_STATE", "source 只能从 registered freeze 首次生成", 409);
  }
  if (input.kind === "study_final" && !["r4_verified", "final_verified"].includes(freeze.status))
    throw new AppError("FINAL_FREEZE_STATE", "study_final 必须在 R4 通过后生成", 409);
  if (["study_final", "study_final_ai"].includes(input.kind) && !input.expectedSourceExportId)
    throw new AppError("SOURCE_REQUIRED", `${input.kind} 必须引用 study_source`, 422);

  const source =
    input.kind === "study_final" || input.kind === "study_final_ai"
      ? (db
          .prepare(
            "SELECT * FROM study_exports WHERE id=? AND study_freeze_id=? AND kind='study_source' AND status='verified' AND is_current=1",
          )
          .get(input.expectedSourceExportId, input.studyFreezeId) as any)
      : null;
  if (["study_final", "study_final_ai"].includes(input.kind) && !source)
    throw new AppError("SOURCE_MISMATCH", "source export 不匹配或未验证", 409);
  if (["study_final", "study_final_ai"].includes(input.kind) && !source.manifest_hash)
    throw new AppError("SOURCE_MANIFEST_MISSING", "source manifest hash 缺失", 409);
  if (["study_final", "study_final_ai"].includes(input.kind)) {
    const manifestPath = path.join(source.storage_relpath, "manifest.json");
    const digestPath = path.join(source.storage_relpath, "manifest.sha256");
    if (
      !fs.existsSync(manifestPath) ||
      !fs.existsSync(digestPath) ||
      sha256(fs.readFileSync(manifestPath)) !== source.manifest_hash ||
      fs.readFileSync(digestPath, "utf8").trim() !== source.manifest_hash
    )
      throw new AppError("SOURCE_MANIFEST_MISMATCH", "source manifest 字节或摘要文件不匹配", 409);
  }

  const sourceForRuns = source ?? existingSource;
  const sourceRuns = sourceForRuns
    ? (db
        .prepare("SELECT run_id FROM study_export_runs WHERE export_id=? ORDER BY ordinal")
        .all(sourceForRuns.id) as Array<{ run_id: string }>)
    : [];
  const canonicalRuns = canonicalRunsForFreeze(freeze);
  const canonicalRunIds = canonicalRuns
    .filter((run) => run.runId)
    .map((run) => run.runId as string);
  if (
    sourceForRuns &&
    (sourceRuns.length !== canonicalRunIds.length ||
      sourceRuns.some((row, index) => row.run_id !== canonicalRunIds[index]))
  )
    throw new AppError(
      "RUN_SET_MISMATCH",
      "study export run set 与 freeze canonical run set 不一致",
      409,
    );
  const runSetHash = sha256(canonicalize(canonicalRuns));
  if (runSetHash !== freeze.run_set_hash)
    throw new AppError(
      "RUN_SET_MISMATCH",
      "freeze run_set_hash 无法由 canonical run set 重算",
      409,
    );
  if (!canonicalRunIds.length)
    throw new AppError("NO_CANONICAL_RUNS", "没有 canonical run，不能导出", 409);

  let reviewFreeze: any = null;
  let formalAiBatch: any = null;
  let outcomeDigest: string | null = null;
  if (input.kind === "study_final") {
    reviewFreeze = db
      .prepare(
        "SELECT * FROM review_freezes WHERE study_freeze_id=? AND status='verified' AND is_current=1 ORDER BY revision DESC LIMIT 1",
      )
      .get(input.studyFreezeId) as any;
    if (!reviewFreeze)
      throw new AppError("REVIEW_FREEZE_REQUIRED", "R2/R3 review freeze 尚未验证", 409);
    const batch = db
      .prepare(
        "SELECT * FROM manual_review_batches WHERE id=? AND study_freeze_id=? AND status IN ('completed','completed_no_eligible_items')",
      )
      .get(reviewFreeze.batch_id, input.studyFreezeId) as any;
    if (!batch) throw new AppError("REVIEWS_NOT_COMPLETE", "R2/R3 尚未完成，不能生成 final", 409);
    const r4Evidence = db
      .prepare(
        "SELECT COUNT(DISTINCT role) count FROM human_gate_evidence WHERE gate_id='R4' AND campaign_id=? AND decision='approved' AND is_current=1",
      )
      .get(freeze.campaign_id) as { count: number };
    if (r4Evidence.count < 2) throw new AppError("R4_REQUIRED", "两位负责人尚未通过 R4", 409);
    outcomeDigest = sha256(
      canonicalize({
        studyFreezeId: input.studyFreezeId,
        sourceManifestHash: source.manifest_hash,
        reviewFreezeHash: reviewFreeze.artifact_hash,
        reportLocalizationHash: freeze.report_localization_hash,
        modelVersion: freeze.model_version,
        modelDecisionHash: freeze.model_decision_hash,
        modelObservationsHash: freeze.model_observations_hash,
        r4EvidenceBundleHash: freeze.r4_evidence_bundle_hash,
      }),
    );
    verifyExpectedDigest(input.expectedOutcomeDigest, outcomeDigest);
    const existingFinal = currentStudyExport(input.studyFreezeId, "study_final");
    if (existingFinal && existingFinal.outcome_digest === outcomeDigest) return existingFinal;
  }
  if (input.kind === "study_final_ai") {
    formalAiBatch = formalBatchForStudy(input.studyFreezeId);
    if (!formalAiBatch)
      throw new AppError(
        "AI_FORMAL_BATCH_REQUIRED",
        "study_final_ai 必须先创建 formal AI batch",
        409,
      );
    if (formalAiBatch.run_id !== null || formalAiBatch.page_id !== null)
      throw new AppError(
        "AI_FORMAL_BATCH_SCOPE_INVALID",
        "formal AI batch 必须不绑定 run/page",
        409,
      );
    const aiBatch = getAiBatch(formalAiBatch.id);
    if (
      formalAiBatch.status !== "completed" ||
      aiBatch.stats.failed > 0 ||
      aiBatch.stats.completed !== aiBatch.stats.total
    )
      throw new AppError(
        "AI_REVIEWS_NOT_COMPLETE",
        "formal AI batch 尚未完成；failed 会阻止正式导出",
        409,
        aiBatch.stats,
      );
    outcomeDigest = sha256(
      canonicalize({
        studyFreezeId: input.studyFreezeId,
        sourceManifestHash: source.manifest_hash,
        formalAiBatchId: formalAiBatch.id,
        batchKey: formalAiBatch.batch_key,
        providerSnapshotHash: formalAiBatch.provider_snapshot_hash,
        promptHash: formalAiBatch.prompt_hash,
        total: aiBatch.stats.total,
        problem: aiBatch.stats.problem,
        notProblem: aiBatch.stats.notProblem,
        uncertain: aiBatch.stats.uncertain,
      }),
    );
    verifyExpectedDigest(input.expectedOutcomeDigest, outcomeDigest);
    const existingAiFinal = currentStudyExport(input.studyFreezeId, "study_final_ai");
    if (existingAiFinal && existingAiFinal.outcome_digest === outcomeDigest) return existingAiFinal;
  }

  const previous =
    input.kind === "study_final" || input.kind === "study_final_ai"
      ? (db
          .prepare(
            "SELECT * FROM study_exports WHERE study_freeze_id=? AND kind=? ORDER BY revision DESC LIMIT 1",
          )
          .get(input.studyFreezeId, input.kind) as any)
      : null;
  let revision = previous ? previous.revision + 1 : 1;
  const exportId =
    input.kind === "study_source"
      ? `study-source-${input.studyFreezeId}`
      : input.kind === "study_final_ai"
        ? `study-final-ai-${(outcomeDigest as string).slice(0, 32)}`
        : `study-final-${(outcomeDigest as string).slice(0, 32)}`;
  const exportRoot = path.join(config.privateEvidenceRoot, "study-exports");
  const target = path.join(exportRoot, exportId);
  const temporary = path.join(exportRoot, `.tmp-${exportId}`);
  const now = new Date().toISOString();
  const sourceManifestHash = ["study_final", "study_final_ai"].includes(input.kind)
    ? source.manifest_hash
    : null;
  const priorGenerating = db.prepare("SELECT * FROM study_exports WHERE id=?").get(exportId) as any;
  if (priorGenerating && ["generating", "invalidated"].includes(priorGenerating.status))
    revision = priorGenerating.revision;
  const generating = {
    id: exportId,
    study_freeze_id: input.studyFreezeId,
    kind: input.kind,
    source_export_id: ["study_final", "study_final_ai"].includes(input.kind)
      ? input.expectedSourceExportId
      : null,
    revision,
    outcome_digest: outcomeDigest,
    supersedes_export_id: previous?.id && previous.id !== exportId ? previous.id : null,
    is_current: 0,
    run_set_hash: runSetHash,
    status: "generating",
    storage_relpath: target,
    manifest_hash: null,
    source_manifest_hash: sourceManifestHash,
    review_freeze_hash: reviewFreeze?.artifact_hash ?? null,
    report_localization_hash: input.kind === "study_final" ? freeze.report_localization_hash : null,
    r4_evidence_bundle_hash: input.kind === "study_final" ? freeze.r4_evidence_bundle_hash : null,
    created_at: now,
    verified_at: null,
  };
  if (priorGenerating?.status === "verified") return priorGenerating;
  if (priorGenerating?.status === "invalidated")
    db.prepare("UPDATE study_exports SET status='generating',is_current=0 WHERE id=?").run(
      exportId,
    );
  if (
    priorGenerating &&
    ["generating", "invalidated"].includes(priorGenerating.status) &&
    fs.existsSync(target)
  ) {
    const privateRoot = path.resolve(config.privateEvidenceRoot);
    const resolvedTarget = path.resolve(target);
    if (!resolvedTarget.startsWith(`${privateRoot}${path.sep}`))
      throw new AppError("EXPORT_PATH_INVALID", "study export 路径越界", 500);
    fs.rmSync(resolvedTarget, { recursive: true, force: true });
  }
  if (fs.existsSync(temporary)) {
    const privateRoot = path.resolve(config.privateEvidenceRoot);
    const resolvedTemporary = path.resolve(temporary);
    if (!resolvedTemporary.startsWith(`${privateRoot}${path.sep}`))
      throw new AppError("EXPORT_PATH_INVALID", "study export 临时路径越界", 500);
    fs.rmSync(resolvedTemporary, { recursive: true, force: true });
  }
  if (!priorGenerating) {
    db.prepare(
      "INSERT INTO study_exports(id,study_freeze_id,kind,source_export_id,revision,outcome_digest,supersedes_export_id,is_current,run_set_hash,status,storage_relpath,manifest_hash,source_manifest_hash,review_freeze_hash,report_localization_hash,r4_evidence_bundle_hash,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      generating.id,
      generating.study_freeze_id,
      generating.kind,
      generating.source_export_id,
      generating.revision,
      generating.outcome_digest,
      generating.supersedes_export_id,
      generating.is_current,
      generating.run_set_hash,
      generating.status,
      generating.storage_relpath,
      generating.manifest_hash,
      generating.source_manifest_hash,
      generating.review_freeze_hash,
      generating.report_localization_hash,
      generating.r4_evidence_bundle_hash,
      generating.created_at,
      generating.verified_at,
    );
  }

  let manifestHash = "";
  try {
    fs.mkdirSync(temporary, { recursive: true });
    let finalBatchId: string | null = null;
    let aiArtifacts: { summary: any; configSnapshot: any; batch: any } | null = null;
    if (input.kind === "study_final") {
      finalBatchId = String(reviewFreeze.batch_id);
      const reviews = db
        .prepare(
          "SELECT mr.* FROM manual_reviews mr JOIN manual_review_samples ms ON ms.id=mr.sample_id WHERE ms.batch_id=? AND mr.review_context='formal' ORDER BY mr.result_node_id,mr.revision",
        )
        .all(finalBatchId);
      fs.writeFileSync(path.join(temporary, "manual-reviews.json"), canonicalize(reviews) + "\n");
      if (!reviewFreeze.storage_relpath || !fs.existsSync(reviewFreeze.storage_relpath))
        throw new AppError("REVIEW_FREEZE_MISSING", "review-freeze artifact 缺失", 409);
      fs.copyFileSync(reviewFreeze.storage_relpath, path.join(temporary, "review-freeze.json"));
    }
    copyRunExports(temporary, canonicalRunIds);
    writeStudyPayload(
      temporary,
      canonicalRunIds,
      finalBatchId ? [finalBatchId] : [],
      input.kind,
      freeze,
      exportId,
      outcomeDigest,
    );
    if (input.kind === "study_final_ai")
      aiArtifacts = writeAiStudyArtifacts(temporary, formalAiBatch.id, canonicalRunIds);
    const localizationHashes = db
      .prepare(
        `SELECT DISTINCT scan_time_localization_hash AS hash FROM scan_runs WHERE id IN (${canonicalRunIds.map(() => "?").join(",")})`,
      )
      .all(...canonicalRunIds)
      .map((row: any) => row.hash)
      .filter(Boolean) as string[];
    if (new Set(localizationHashes).size > 1)
      throw new AppError(
        "LOCALIZATION_VERSION_MISMATCH",
        "同一 study export 不能混用扫描时中文目录版本",
        409,
      );
    const campaign = db
      .prepare("SELECT campaign_plan_hash FROM study_campaigns WHERE id=?")
      .get(freeze.campaign_id) as { campaign_plan_hash: string };
    const manifest = {
      schemaVersion: "canonical-manifest-json-v1",
      exportId,
      generatedAt: new Date().toISOString(),
      exportKind: input.kind,
      kind: input.kind,
      studyFreezeId: input.studyFreezeId,
      freezeDigest: freeze.freeze_digest,
      populationDigest: freeze.population_digest,
      campaignPlanHash: campaign.campaign_plan_hash,
      attemptLogHash: freeze.attempt_log_hash,
      executionLogHash: freeze.execution_log_hash,
      catalogVersion: freeze.catalog_version,
      ruleCatalogHash: freeze.rule_catalog_hash,
      runSetHash,
      sourceExportId: ["study_final", "study_final_ai"].includes(input.kind)
        ? input.expectedSourceExportId
        : null,
      sourceManifestHash,
      outcomeDigest,
      supersedesExportId: previous?.id ?? null,
      publicationStatus: "unpublished",
      appGitCommit: process.env.APP_GIT_COMMIT ?? null,
      databaseMigration:
        (
          db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
            | { version: number | null }
            | undefined
        )?.version ?? null,
      scanTimeLocalizationHash: localizationHashes[0] ?? null,
      modelDecisionHash: input.kind === "study_final" ? freeze.model_decision_hash : null,
      modelObservationsHash: input.kind === "study_final" ? freeze.model_observations_hash : null,
      reviewFreezeHash: reviewFreeze?.artifact_hash ?? null,
      reportLocalizationHash: input.kind === "study_final" ? freeze.report_localization_hash : null,
      r4EvidenceBundleHash: input.kind === "study_final" ? freeze.r4_evidence_bundle_hash : null,
      aiBatchId: input.kind === "study_final_ai" ? formalAiBatch.id : null,
      aiProviderSnapshotHash:
        input.kind === "study_final_ai" ? formalAiBatch.provider_snapshot_hash : null,
      aiPromptHash: input.kind === "study_final_ai" ? formalAiBatch.prompt_hash : null,
      aiSummaryHash:
        input.kind === "study_final_ai" && aiArtifacts
          ? sha256(fs.readFileSync(path.join(temporary, "ai", "summary.json")))
          : null,
      revision,
      runIds: canonicalRunIds,
      files: fileManifest(temporary),
    };
    const manifestBytes = Buffer.from(canonicalize(manifest) + "\n");
    fs.writeFileSync(path.join(temporary, "manifest.json"), manifestBytes);
    fs.writeFileSync(path.join(temporary, "manifest.sha256"), `${sha256(manifestBytes)}\n`);
    manifestHash = sha256(manifestBytes);
    validateStudyPayload(temporary, input.kind, exportId);
    validateManifestDocument(temporary, input.kind, exportId);
    readonlyTree(temporary);
    if (fs.existsSync(target)) {
      const privateRoot = path.resolve(config.privateEvidenceRoot);
      const resolvedTarget = path.resolve(target);
      if (!resolvedTarget.startsWith(`${privateRoot}${path.sep}`))
        throw new AppError("EXPORT_PATH_INVALID", "study export 路径越界", 500);
      fs.rmSync(resolvedTarget, { recursive: true, force: true });
    }
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  const verifiedAt = new Date().toISOString();
  const record = {
    ...generating,
    status: "verified",
    is_current: 1,
    manifest_hash: manifestHash,
    verified_at: verifiedAt,
  };
  try {
    transaction((tx) => {
      if (previous)
        tx.prepare(
          "UPDATE study_exports SET is_current=0,status=CASE WHEN status='invalidated' THEN status ELSE 'superseded' END,publication_revision=publication_revision+1 WHERE id=? AND is_current=1",
        ).run(previous.id);
      tx.prepare(
        "UPDATE study_exports SET is_current=1,status='verified',manifest_hash=?,verified_at=? WHERE id=? AND status='generating'",
      ).run(manifestHash, verifiedAt, exportId);
      tx.prepare("DELETE FROM study_export_runs WHERE export_id=?").run(exportId);
      canonicalRunIds.forEach((runId, index) =>
        tx
          .prepare("INSERT INTO study_export_runs(export_id,run_id,ordinal) VALUES (?,?,?)")
          .run(exportId, runId, index),
      );
      if (input.kind === "study_source")
        tx.prepare(
          "UPDATE study_freezes SET status='source_verified' WHERE id=? AND status='registered'",
        ).run(input.studyFreezeId);
      if (input.kind === "study_final")
        tx.prepare(
          "UPDATE study_freezes SET status='final_verified',final_verified_at=? WHERE id=? AND status='r4_verified'",
        ).run(verifiedAt, input.studyFreezeId);
    });
  } catch (error) {
    const concurrent = db
      .prepare("SELECT * FROM study_exports WHERE id=? AND status='verified'")
      .get(exportId) as any;
    if (concurrent) return concurrent;
    throw error;
  }
  return record;
}
