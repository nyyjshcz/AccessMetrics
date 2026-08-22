import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { config } from "./config";
import { id } from "./ids";
import { buildRunScore } from "./run-score";
import { canonicalize, sha256 } from "./canonical";

export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  // Prefix spreadsheet formula characters so exported evidence cannot become
  // an executable formula when opened by Excel/LibreOffice.
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function exportRun(runId: string) {
  const run = getDb()
    .prepare(
      "SELECT r.*,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
    )
    .get(runId) as any;
  if (!run) throw new Error("run not found");
  const existing = getDb()
    .prepare(
      "SELECT id,path,manifest_hash FROM exports WHERE run_id=? AND kind='run' AND status='verified' ORDER BY created_at DESC LIMIT 1",
    )
    .get(runId) as { id: string; path: string; manifest_hash: string } | undefined;
  if (existing && fs.existsSync(existing.path))
    return {
      exportId: existing.id,
      target: existing.path,
      manifestHash: existing.manifest_hash,
      files: [],
    };
  const exportId = id("export");
  const target = path.join(config.privateEvidenceRoot, "exports", exportId);
  fs.mkdirSync(target, { recursive: true });
  const issues = getDb()
    .prepare(
      "SELECT rr.*,p.canonical_url FROM rule_results rr JOIN pages p ON p.id=rr.page_id WHERE rr.run_id=? ORDER BY p.canonical_url,rr.rule_id,rr.result_type",
    )
    .all(runId) as any[];
  const resultNodes = getDb()
    .prepare(
      `SELECT n.id AS result_node_id,n.rule_result_id,n.ordinal,n.frame_path_json,
              n.frame_url,n.frame_origin_relation,n.target_json,n.target_hash,
              n.impact,n.effective_impact,n.severity_weight,n.severity_source,
              n.html_excerpt,n.failure_summary,n.any_json,n.all_json,n.none_json
         FROM result_nodes n
         JOIN rule_results rr ON rr.id=n.rule_result_id
        WHERE rr.run_id=? ORDER BY rr.page_id,rr.rule_id,rr.result_type,n.ordinal`,
    )
    .all(runId) as any[];
  const pageScores = getDb()
    .prepare("SELECT * FROM page_scores WHERE run_id=? ORDER BY page_id")
    .all(runId) as any[];
  const siteScore = getDb().prepare("SELECT * FROM site_scores WHERE run_id=?").get(runId) as any;
  const reviewRows = getDb()
    .prepare(
      `SELECT mr.result_node_id,mr.sample_id,mr.review_context,mr.reviewer,mr.verdict,
              mrs.batch_id,mrb.status AS batch_status,mrb.source_export_id,mrb.source_manifest_hash
         FROM manual_reviews mr
         JOIN result_nodes n ON n.id=mr.result_node_id
         JOIN rule_results rr ON rr.id=n.rule_result_id
         LEFT JOIN manual_review_samples mrs ON mrs.id=mr.sample_id
         LEFT JOIN manual_review_batches mrb ON mrb.id=mrs.batch_id
        WHERE rr.run_id=? AND mr.is_current=1
        ORDER BY mr.result_node_id,mr.review_context,mr.reviewer`,
    )
    .all(runId) as Array<{
    result_node_id: string;
    sample_id: string | null;
    review_context: string;
    reviewer: string;
    verdict: string;
    batch_id: string | null;
    batch_status: string | null;
    source_export_id: string | null;
    source_manifest_hash: string | null;
  }>;
  const reviewRefs: Array<Record<string, unknown>> = [];
  const formalGroups = new Map<string, typeof reviewRows>();
  for (const row of reviewRows) {
    if (row.review_context === "formal" && row.sample_id) {
      const group = formalGroups.get(row.sample_id) ?? [];
      group.push(row);
      formalGroups.set(row.sample_id, group);
      continue;
    }
    if (row.review_context === "ad_hoc")
      reviewRefs.push({
        resultNodeId: row.result_node_id,
        finalVerdict: row.verdict,
        resolutionSource: "ad_hoc",
        batchRef: null,
      });
  }
  for (const rows of formalGroups.values()) {
    const first = rows[0];
    const batchRef = first.batch_id
      ? {
          batchId: first.batch_id,
          sourceExportId: first.source_export_id,
          sourceManifestHash: first.source_manifest_hash,
          ...(first.batch_status &&
          !["completed", "completed_no_eligible_items"].includes(first.batch_status)
            ? { status: first.batch_status }
            : {}),
        }
      : null;
    if (
      !first.batch_status ||
      !["completed", "completed_no_eligible_items"].includes(first.batch_status)
    ) {
      reviewRefs.push({
        resultNodeId: first.result_node_id,
        finalVerdict: null,
        resolutionSource: "agreement",
        batchRef,
      });
      continue;
    }
    const verdicts = new Set(rows.map((row) => row.verdict));
    if (verdicts.size === 1) {
      reviewRefs.push({
        resultNodeId: first.result_node_id,
        finalVerdict: first.verdict,
        resolutionSource: "agreement",
        batchRef,
      });
      continue;
    }
    const adjudication = getDb()
      .prepare(
        "SELECT adjudicated_verdict FROM manual_review_adjudications WHERE sample_id=? AND status='approved' AND is_current=1 ORDER BY revision DESC LIMIT 1",
      )
      .get(first.sample_id) as { adjudicated_verdict: string } | undefined;
    reviewRefs.push({
      resultNodeId: first.result_node_id,
      finalVerdict: adjudication?.adjudicated_verdict ?? null,
      resolutionSource: adjudication ? "adjudication" : "agreement",
      batchRef,
    });
  }
  reviewRefs.sort((a, b) => String(a.resultNodeId).localeCompare(String(b.resultNodeId)));
  const options = (() => {
    try {
      return JSON.parse(run.config_snapshot_json ?? "{}");
    } catch {
      return {};
    }
  })();
  const catalogPath = path.join(process.cwd(), "configs", "axe-rule-catalog.json");
  const criteriaPath = path.join(process.cwd(), "scoring", "wcag-criteria.v2.2.json");
  const localizationPath = path.join(process.cwd(), "scoring", "rule-localizations.zh-CN.json");
  const fileHash = (file: string) => (fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null);
  const provenance = {
    appGitCommit: process.env.APP_GIT_COMMIT ?? null,
    scannerVersion: run.scanner_version,
    playwrightVersion: process.env.PLAYWRIGHT_VERSION ?? null,
    axeVersion: run.axe_version,
    ruleCatalogVersion: run.catalog_version,
    ruleCatalogHash: fileHash(catalogPath),
    scanTimeLocalizationHash: run.scan_time_localization_hash ?? fileHash(localizationPath),
    wcagCriteriaHash: fileHash(criteriaPath),
    scoreModelVersion: run.score_model_version ?? "accesscheck-score-v1",
    databaseMigration: run.database_migration ?? null,
  };
  const pages = getDb()
    .prepare(
      "SELECT canonical_url,scan_status,http_status,error_code,frame_total,same_origin_frame_total,cross_origin_frame_total,frame_tested_total,frame_skipped_total,frame_error_count,frame_coverage_status,frame_coverage_issues_json,axe_timestamp,axe_test_engine_json,axe_test_environment_json,axe_tool_options_json FROM pages WHERE run_id=? ORDER BY canonical_url",
    )
    .all(runId) as any[];
  const payload = {
    schemaVersion: "scan-export-v1",
    exportId,
    generatedAt: new Date().toISOString(),
    site: { id: run.site_id, origin: run.origin, name: run.name },
    configSnapshot: options,
    run,
    score: buildRunScore(runId),
    pages,
    issues: issues.map((row) => {
      const { tags_json: _tagsJson, raw_json: _rawJson, ...rest } = row;
      return { ...rest, tags: JSON.parse(row.tags_json), raw: JSON.parse(row.raw_json) };
    }),
    ruleResults: issues.map((row) => {
      const { tags_json: _tagsJson, raw_json: _rawJson, ...rest } = row;
      return { ...rest, tags: JSON.parse(row.tags_json) };
    }),
    resultNodes,
    pageScores,
    siteScore: siteScore ?? null,
    reviewRefs,
    provenance,
  };
  const jsonBytes = Buffer.from(canonicalize(payload) + "\n", "utf8");
  fs.writeFileSync(path.join(target, "scan.json"), jsonBytes);
  const columns = [
    "canonical_url",
    "rule_id",
    "result_type",
    "impact",
    "description",
    "help_url",
    "node_count",
  ];
  const csv =
    [
      columns.join(","),
      ...issues.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
    ].join("\n") + "\n";
  fs.writeFileSync(path.join(target, "issues.csv"), csv);
  const files = ["scan.json", "issues.csv"].map((file) => {
    const bytes = fs.readFileSync(path.join(target, file));
    return { path: file, size: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = {
    schemaVersion: "canonical-manifest-json-v1",
    exportId,
    files,
    generatedAt: new Date().toISOString(),
  };
  const manifestBytes = Buffer.from(canonicalize(manifest) + "\n");
  fs.writeFileSync(path.join(target, "manifest.json"), manifestBytes);
  fs.writeFileSync(path.join(target, "manifest.sha256"), `${sha256(manifestBytes)}\n`);
  const manifestHash = sha256(manifestBytes);
  getDb()
    .prepare("UPDATE scan_runs SET export_id=?,manifest_hash=? WHERE id=?")
    .run(exportId, manifestHash, runId);
  getDb()
    .prepare(
      "INSERT INTO exports(id,run_id,kind,path,manifest_hash,created_at,status) VALUES (?,?,?,?,?,?,?)",
    )
    .run(exportId, runId, "run", target, manifestHash, new Date().toISOString(), "verified");
  return { exportId, target, manifestHash, files };
}
