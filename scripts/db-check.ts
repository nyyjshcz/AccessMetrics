import { getDb, migrate } from "../src/lib/db";
migrate();
const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all() as Array<{ name: string }>;
const requiredTables = [
  "sites",
  "scan_jobs",
  "scan_runs",
  "pages",
  "job_pages",
  "rule_results",
  "result_nodes",
  "page_scores",
  "site_scores",
  "study_campaigns",
  "study_freezes",
  "study_exports",
  "manual_review_batches",
  "manual_reviews",
  "human_gate_evidence",
  "r5_sessions",
  "r5_owner_artifacts",
  "r5_exercise_steps",
  "r5_artifact_bundles",
  "r5_artifact_outbox",
  "ai_provider_configs",
  "ai_review_batches",
  "ai_review_items",
];
const tableSet = new Set(tables.map((row) => row.name));
const missingTables = requiredTables.filter((name) => !tableSet.has(name));
const requiredColumns = {
  scan_jobs: [
    "submitted_url",
    "normalized_url",
    "idempotency_key",
    "request_id",
    "max_pages",
    "heartbeat_at",
    "worker_id",
  ],
  scan_runs: [
    "job_id",
    "site_id",
    "scanner_version",
    "axe_version",
    "catalog_version",
    "scan_time_localization_hash",
    "score_model_version",
    "rule_catalog_hash",
    "config_snapshot_json",
    "viewport_json",
    "user_agent",
    "created_at",
  ],
  study_freezes: ["catalog_version", "rule_catalog_hash"],
  pages: [
    "content_type",
    "frame_coverage_status",
    "frame_coverage_issues_json",
    "axe_timestamp",
    "axe_test_engine_json",
    "axe_test_environment_json",
    "axe_tool_options_json",
    "job_page_id",
    "created_at",
  ],
  job_pages: [
    "id",
    "job_id",
    "page_id",
    "requested_url",
    "normalized_url",
    "discovery_order",
    "status",
    "attempt_count",
    "lease_owner",
    "lease_expires_at",
  ],
  rule_results: [
    "page_id",
    "result_type",
    "rule_id",
    "wcag_criteria_json",
    "principles_json",
    "wcag_level_json",
    "scoring_eligible",
    "node_count",
    "created_at",
  ],
  result_nodes: [
    "rule_result_id",
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
    "checks_json",
    "ai_evidence_json",
    "ai_evidence_hash",
    "ai_evidence_version",
    "created_at",
  ],
  page_scores: [
    "total_score",
    "total_score_tenths",
    "total_numerator",
    "total_denominator",
    "score_details_json",
    "created_at",
  ],
  site_scores: [
    "total_score",
    "total_score_tenths",
    "total_numerator",
    "total_denominator",
    "score_details_json",
    "created_at",
  ],
  study_exports: ["publication_status", "publication_revision", "published_at", "withdrawn_at"],
  human_gate_evidence: ["campaign_id"],
  r5_owner_artifacts: [
    "artifact_type",
    "role",
    "bound_rc_commit",
    "bound_tree_hash",
    "r1_r4_index_hash",
    "catalog_hash",
    "status",
    "payload_json",
    "artifact_hash",
    "revision",
    "supersedes_artifact_id",
    "is_current",
    "created_at",
    "finalized_at",
  ],
  r5_exercise_steps: [
    "artifact_id",
    "step_id",
    "command_id",
    "status",
    "exit_code",
    "output_sha256",
    "observation",
    "completed_at",
  ],
  r5_artifact_bundles: [
    "rc_commit",
    "r1_r4_index_hash",
    "computer_exercise_hash",
    "computer_understanding_hash",
    "computer_handoff_hash",
    "math_exercise_hash",
    "math_understanding_hash",
    "math_handoff_hash",
    "status",
    "bundle_hash",
    "created_at",
  ],
  r5_artifact_outbox: [
    "artifact_kind",
    "artifact_id",
    "target_relpath",
    "canonical_json",
    "expected_file_hash",
    "status",
    "attempt_count",
    "last_error",
    "created_at",
    "written_at",
  ],
};
const missingColumns: string[] = [];
for (const [table, columns] of Object.entries(requiredColumns)) {
  const available = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  for (const column of columns)
    if (!available.has(column)) missingColumns.push(`${table}.${column}`);
}
const pagesTable = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pages'")
  .get() as { sql?: string } | undefined;
const legacySiteWidePageUnique = Boolean(
  pagesTable?.sql && /UNIQUE\s*\(\s*site_id\s*,\s*canonical_url\s*\)/i.test(pagesTable.sql),
);
const missingIndexes: string[] = [];
for (const indexName of [
  "idx_pages_run_normalized",
  "idx_pages_job_page_unique",
  "idx_job_pages_normalized_url",
  "idx_scan_runs_job_unique",
  "idx_manual_reviews_current_unique",
  "idx_manual_reviews_ad_hoc_current_unique",
  "idx_adjudications_current_unique",
  "idx_scan_jobs_status_created",
  "idx_job_pages_job_status_discovery",
  "idx_job_pages_lease",
  "idx_scan_runs_published",
  "idx_pages_run_status",
  "idx_rule_results_page_type_rule",
  "idx_study_freezes_digest_status",
  "idx_study_exports_status",
  "idx_study_exports_publication",
  "idx_study_exports_gate",
  "idx_study_export_runs_export_ordinal",
  "idx_manual_samples_stratum",
  "idx_manual_reviews_reviewed",
  "idx_review_freezes_current",
  "idx_gate_evidence_current",
  "idx_gate_outbox_status",
  "idx_r5_owner_artifacts_role_type_current_status",
  "idx_r5_exercise_steps_artifact_status",
  "idx_r5_artifact_bundles_commit_status",
  "idx_r5_artifact_outbox_status_only",
  "idx_ai_formal_batch_study_freeze",
  "idx_ai_batches_scope",
  "idx_ai_items_status_lease",
  "idx_ai_items_batch",
  "idx_ai_items_node",
]) {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='index' AND name=?")
    .get(indexName) as { present: number } | undefined;
  if (!row) missingIndexes.push(indexName);
}
console.log(
  JSON.stringify(
    {
      foreignKeys: db.pragma("foreign_keys"),
      tables: tables.map((row) => row.name),
      missingTables,
      missingColumns,
      legacySiteWidePageUnique,
      missingIndexes,
    },
    null,
    2,
  ),
);
if (
  missingTables.length ||
  missingColumns.length ||
  legacySiteWidePageUnique ||
  missingIndexes.length
)
  process.exitCode = 1;
