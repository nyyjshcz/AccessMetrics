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
];
const tableSet = new Set(tables.map((row) => row.name));
const missingTables = requiredTables.filter((name) => !tableSet.has(name));
const requiredColumns = {
  scan_runs: [
    "scan_time_localization_hash",
    "score_model_version",
    "rule_catalog_hash",
    "config_snapshot_json",
    "viewport_json",
    "user_agent",
  ],
  pages: [
    "content_type",
    "frame_coverage_status",
    "frame_coverage_issues_json",
    "axe_timestamp",
    "axe_test_engine_json",
    "axe_test_environment_json",
    "axe_tool_options_json",
  ],
  study_exports: ["publication_status", "publication_revision", "published_at", "withdrawn_at"],
  human_gate_evidence: ["campaign_id"],
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
console.log(
  JSON.stringify(
    {
      foreignKeys: db.pragma("foreign_keys"),
      tables: tables.map((row) => row.name),
      missingTables,
      missingColumns,
    },
    null,
    2,
  ),
);
if (missingTables.length || missingColumns.length) process.exitCode = 1;
