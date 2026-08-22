import fs from "node:fs";
import path from "node:path";
import { getDb, transaction } from "./db";
import { config } from "./config";
import { canonicalize, sha256 } from "./canonical";
import { exportRun } from "./export";
import { AppError } from "./errors";

type ExportKind = "study_source" | "study_final";

const CSV_TABLES = {
  "sites.csv": ["id", "origin", "name", "created_at", "updated_at", "status"],
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

function copyRunExports(target: string, runIds: string[], allowedReviewNodeIds: Set<string>) {
  for (const runId of runIds) {
    const generated = exportRun(runId);
    const destination = path.join(target, "runs", runId);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ["scan.json", "issues.csv", "manifest.json", "manifest.sha256"])
      fs.copyFileSync(path.join(generated.target, file), path.join(destination, file));
    const scanPath = path.join(destination, "scan.json");
    const scan = JSON.parse(fs.readFileSync(scanPath, "utf8")) as Record<string, unknown>;
    scan.reviewRefs = (Array.isArray(scan.reviewRefs) ? scan.reviewRefs : []).filter((ref) =>
      allowedReviewNodeIds.has(String((ref as Record<string, unknown>).resultNodeId)),
    );
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
  fs.writeFileSync(
    path.join(configDir, "scoring-config.v1.json"),
    `${canonicalize({ schemaVersion: "accesscheck-scoring-config-v1", modelVersion: "accesscheck-score-v1", weights: { critical: 40, serious: 30, moderate: 20, minor: 10 }, maximumWeight: 40 })}\n`,
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
    const modelDecision = path.join(process.cwd(), "scoring", "model-decision-record.md");
    const modelObservations = path.join(
      process.cwd(),
      "analysis",
      "outputs",
      "model-observations.md",
    );
    if (!fs.existsSync(modelDecision) || !fs.existsSync(modelObservations))
      throw new AppError(
        "FINAL_ANALYSIS_MISSING",
        "study_final 缺少已核验的模型决策/观察文件",
        409,
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
    fs.copyFileSync(
      path.join(process.cwd(), "scoring", "rule-localizations.zh-CN.json"),
      path.join(configDir, "rule-localizations.report.zh-CN.json"),
    );
  }
  return rows;
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
  if (input.kind === "study_final" && !input.expectedSourceExportId)
    throw new AppError("SOURCE_REQUIRED", "study_final 必须引用 study_source", 422);

  const source =
    input.kind === "study_final"
      ? (db
          .prepare(
            "SELECT * FROM study_exports WHERE id=? AND study_freeze_id=? AND kind='study_source' AND status='verified' AND is_current=1",
          )
          .get(input.expectedSourceExportId, input.studyFreezeId) as any)
      : null;
  if (input.kind === "study_final" && !source)
    throw new AppError("SOURCE_MISMATCH", "source export 不匹配或未验证", 409);
  if (input.kind === "study_final" && !source.manifest_hash)
    throw new AppError("SOURCE_MANIFEST_MISSING", "source manifest hash 缺失", 409);
  if (input.kind === "study_final") {
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
        "SELECT * FROM manual_review_batches WHERE study_freeze_id=? AND status IN ('completed','completed_no_eligible_items')",
      )
      .get(input.studyFreezeId) as any;
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

  const previous =
    input.kind === "study_final"
      ? (db
          .prepare(
            "SELECT * FROM study_exports WHERE study_freeze_id=? AND kind='study_final' ORDER BY revision DESC LIMIT 1",
          )
          .get(input.studyFreezeId) as any)
      : null;
  let revision = previous ? previous.revision + 1 : 1;
  const exportId =
    input.kind === "study_source"
      ? `study-source-${input.studyFreezeId}`
      : `study-final-${(outcomeDigest as string).slice(0, 32)}`;
  const target = path.join(config.privateEvidenceRoot, "study-exports", exportId);
  const now = new Date().toISOString();
  const sourceManifestHash = input.kind === "study_final" ? source.manifest_hash : null;
  const priorGenerating = db.prepare("SELECT * FROM study_exports WHERE id=?").get(exportId) as any;
  if (priorGenerating && ["generating", "invalidated"].includes(priorGenerating.status))
    revision = priorGenerating.revision;
  const generating = {
    id: exportId,
    study_freeze_id: input.studyFreezeId,
    kind: input.kind,
    source_export_id: input.kind === "study_final" ? input.expectedSourceExportId : null,
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

  fs.mkdirSync(target, { recursive: true });
  let finalBatchId: string | null = null;
  if (input.kind === "study_final") {
    const batch = db
      .prepare(
        "SELECT id FROM manual_review_batches WHERE study_freeze_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(input.studyFreezeId) as { id: string };
    finalBatchId = batch.id;
    const reviews = db
      .prepare(
        "SELECT mr.* FROM manual_reviews mr JOIN manual_review_samples ms ON ms.result_node_id=mr.result_node_id WHERE ms.batch_id=? ORDER BY mr.result_node_id,mr.revision",
      )
      .all(batch.id);
    fs.writeFileSync(path.join(target, "manual-reviews.json"), canonicalize(reviews) + "\n");
    if (!reviewFreeze.storage_relpath || !fs.existsSync(reviewFreeze.storage_relpath))
      throw new AppError("REVIEW_FREEZE_MISSING", "review-freeze artifact 缺失", 409);
    fs.copyFileSync(reviewFreeze.storage_relpath, path.join(target, "review-freeze.json"));
  }
  const allowedReviewNodeIds = new Set<string>();
  if (finalBatchId) {
    for (const row of db
      .prepare("SELECT result_node_id FROM manual_review_samples WHERE batch_id=?")
      .all(finalBatchId) as Array<{ result_node_id: string }>)
      allowedReviewNodeIds.add(row.result_node_id);
  }
  copyRunExports(target, canonicalRunIds, allowedReviewNodeIds);
  writeStudyPayload(
    target,
    canonicalRunIds,
    finalBatchId ? [finalBatchId] : [],
    input.kind,
    freeze,
    exportId,
    outcomeDigest,
  );
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
    runSetHash,
    sourceExportId: input.kind === "study_final" ? input.expectedSourceExportId : null,
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
    revision,
    runIds: canonicalRunIds,
    files: fileManifest(target),
  };
  const manifestBytes = Buffer.from(canonicalize(manifest) + "\n");
  fs.writeFileSync(path.join(target, "manifest.json"), manifestBytes);
  fs.writeFileSync(path.join(target, "manifest.sha256"), `${sha256(manifestBytes)}\n`);
  const manifestHash = sha256(manifestBytes);
  readonlyTree(target);
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
