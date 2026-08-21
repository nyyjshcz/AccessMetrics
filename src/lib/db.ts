import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config";
import { logger } from "./logger";

let database: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!database) {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
    database = new Database(config.databasePath);
    database.pragma("foreign_keys = ON");
    database.pragma("journal_mode = WAL");
    database.pragma("busy_timeout = 5000");
  }
  return database;
}

export function closeDb() {
  database?.close();
  database = undefined;
}

export function transaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDb();
  return db.transaction(() => fn(db))();
}

export function migrate() {
  const db = getDb();
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
  const applied = new Set<number>(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((r: any) => r.version),
  );
  const migrations = [
    migration001,
    migration002,
    migration003,
    migration004,
    migration005,
    migration006,
    migration007,
    migration008,
    migration009,
    migration010,
    migration011,
    migration012,
    migration013,
    migration014,
    migration015,
    migration016,
    migration017,
  ];
  for (let index = 0; index < migrations.length; index++) {
    const version = index + 1;
    if (applied.has(version)) continue;
    db.transaction(() => {
      migrations[index](db);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
    })();
    logger.info({ version }, "database migration applied");
  }
}

function migration001(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY, origin TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS scan_jobs (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
      status TEXT NOT NULL, options_json TEXT NOT NULL, requested_by TEXT, created_at TEXT NOT NULL,
      started_at TEXT, finished_at TEXT, error_code TEXT, error_message TEXT, lease_owner TEXT, lease_until TEXT
    );
    CREATE TABLE IF NOT EXISTS scan_runs (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES scan_jobs(id) ON DELETE RESTRICT,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT, scanner_version TEXT NOT NULL,
      axe_version TEXT NOT NULL, catalog_version TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
      status TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0, score_json TEXT, export_id TEXT, manifest_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT, canonical_url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL, UNIQUE(site_id, canonical_url)
    );
    CREATE TABLE IF NOT EXISTS job_pages (
      job_id TEXT NOT NULL REFERENCES scan_jobs(id) ON DELETE RESTRICT, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
      discovery_order INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT, lease_until TEXT, last_error TEXT, PRIMARY KEY(job_id, page_id)
    );
    CREATE TABLE IF NOT EXISTS rule_results (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
      rule_id TEXT NOT NULL, result_type TEXT NOT NULL, impact TEXT, description TEXT NOT NULL, help TEXT NOT NULL,
      help_url TEXT NOT NULL, tags_json TEXT NOT NULL, node_count INTEGER NOT NULL DEFAULT 0, raw_json TEXT NOT NULL,
      UNIQUE(run_id, page_id, rule_id, result_type)
    );
    CREATE TABLE IF NOT EXISTS result_nodes (
      id TEXT PRIMARY KEY, rule_result_id TEXT NOT NULL REFERENCES rule_results(id) ON DELETE RESTRICT,
      ordinal INTEGER NOT NULL, target_json TEXT NOT NULL, html_sanitized TEXT NOT NULL, failure_summary TEXT,
      any_json TEXT NOT NULL, all_json TEXT NOT NULL, none_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS page_scores (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE RESTRICT,
      perceivable_num INTEGER NOT NULL, perceivable_den INTEGER NOT NULL, operable_num INTEGER NOT NULL, operable_den INTEGER NOT NULL,
      understandable_num INTEGER NOT NULL, understandable_den INTEGER NOT NULL, robust_num INTEGER NOT NULL, robust_den INTEGER NOT NULL,
      overall_num INTEGER NOT NULL, overall_den INTEGER NOT NULL, weighted_defects INTEGER NOT NULL, total_violations INTEGER NOT NULL,
      model_version TEXT NOT NULL, UNIQUE(run_id, page_id)
    );
    CREATE TABLE IF NOT EXISTS site_scores (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES scan_runs(id) ON DELETE RESTRICT,
      perceivable_num INTEGER NOT NULL, perceivable_den INTEGER NOT NULL, operable_num INTEGER NOT NULL, operable_den INTEGER NOT NULL,
      understandable_num INTEGER NOT NULL, understandable_den INTEGER NOT NULL, robust_num INTEGER NOT NULL, robust_den INTEGER NOT NULL,
      overall_num INTEGER NOT NULL, overall_den INTEGER NOT NULL, page_count INTEGER NOT NULL, model_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, token_hash TEXT NOT NULL UNIQUE,
      csrf_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT, kind TEXT NOT NULL,
      path TEXT NOT NULL, manifest_hash TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      details_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_job_pages_status ON job_pages(job_id, status, discovery_order);
    CREATE INDEX IF NOT EXISTS idx_rule_results_run ON rule_results(run_id, page_id, impact);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
  `);
}

function migration002(db: Database.Database) {
  const addColumn = (table: string, column: string, definition: string) => {
    const exists = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(
      (row) => row.name === column,
    );
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  addColumn("sites", "display_name", "TEXT");
  addColumn("sites", "category", "TEXT");
  addColumn("scan_jobs", "submitted_url", "TEXT");
  addColumn("scan_jobs", "normalized_url", "TEXT");
  addColumn("scan_jobs", "idempotency_key", "TEXT");
  addColumn("scan_jobs", "request_id", "TEXT");
  addColumn("scan_jobs", "heartbeat_at", "TEXT");
  addColumn("scan_jobs", "worker_id", "TEXT");
  addColumn("scan_runs", "score_model_version", "TEXT");
  addColumn("scan_runs", "rule_catalog_hash", "TEXT");
  addColumn("scan_runs", "config_snapshot_json", "TEXT");
  addColumn("scan_runs", "viewport_json", "TEXT");
  addColumn("scan_runs", "user_agent", "TEXT");
  addColumn("scan_runs", "published", "INTEGER NOT NULL DEFAULT 0");
  addColumn("scan_runs", "published_at", "TEXT");
  addColumn("pages", "run_id", "TEXT");
  addColumn("pages", "requested_url", "TEXT");
  addColumn("pages", "final_url", "TEXT");
  addColumn("pages", "normalized_url", "TEXT");
  addColumn("pages", "title", "TEXT");
  addColumn("pages", "crawl_depth", "INTEGER NOT NULL DEFAULT 0");
  addColumn("pages", "discovered_from_url", "TEXT");
  addColumn("pages", "http_status", "INTEGER");
  addColumn("pages", "content_type", "TEXT");
  addColumn("pages", "load_ms", "INTEGER");
  addColumn("pages", "scan_status", "TEXT NOT NULL DEFAULT 'success'");
  addColumn("pages", "error_code", "TEXT");
  addColumn("pages", "error_message", "TEXT");
  addColumn("pages", "frame_total", "INTEGER NOT NULL DEFAULT 0");
  addColumn("pages", "same_origin_frame_total", "INTEGER NOT NULL DEFAULT 0");
  addColumn("pages", "cross_origin_frame_total", "INTEGER NOT NULL DEFAULT 0");
  addColumn("pages", "frame_tested_total", "INTEGER NOT NULL DEFAULT 0");
  addColumn("pages", "frame_skipped_total", "INTEGER NOT NULL DEFAULT 0");
  addColumn("pages", "frame_error_count", "INTEGER NOT NULL DEFAULT 0");
  addColumn("pages", "frame_coverage_status", "TEXT NOT NULL DEFAULT 'no_child_frames'");
  addColumn("job_pages", "requested_url", "TEXT");
  addColumn("job_pages", "normalized_url", "TEXT");
  addColumn("job_pages", "discovered_from_url", "TEXT");
  addColumn("job_pages", "crawl_depth", "INTEGER NOT NULL DEFAULT 0");
  addColumn("job_pages", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
  addColumn("job_pages", "lease_expires_at", "TEXT");
  addColumn("job_pages", "last_error_code", "TEXT");
  addColumn("job_pages", "created_at", "TEXT");
  addColumn("job_pages", "updated_at", "TEXT");
  addColumn("rule_results", "wcag_criteria_json", "TEXT");
  addColumn("rule_results", "principles_json", "TEXT");
  addColumn("rule_results", "wcag_level_json", "TEXT");
  addColumn("rule_results", "scoring_eligible", "INTEGER NOT NULL DEFAULT 1");
  addColumn("rule_results", "created_at", "TEXT");
  addColumn("result_nodes", "frame_path_json", "TEXT");
  addColumn("result_nodes", "frame_url", "TEXT");
  addColumn("result_nodes", "frame_origin_relation", "TEXT");
  addColumn("result_nodes", "target_hash", "TEXT");
  addColumn("result_nodes", "impact", "TEXT");
  addColumn("result_nodes", "effective_impact", "TEXT");
  addColumn("result_nodes", "severity_weight", "INTEGER");
  addColumn("result_nodes", "severity_source", "TEXT");
  addColumn("result_nodes", "html_excerpt", "TEXT");
  addColumn("result_nodes", "checks_json", "TEXT");
  addColumn("result_nodes", "created_at", "TEXT");
  addColumn("page_scores", "score_details_json", "TEXT");
  addColumn("site_scores", "score_details_json", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS study_campaigns (id TEXT PRIMARY KEY, campaign_plan_hash TEXT NOT NULL UNIQUE, protocol_hash TEXT NOT NULL, sample_frame_hash TEXT NOT NULL, baseline_triple_json TEXT NOT NULL, target_site_count INTEGER NOT NULL CHECK(target_site_count BETWEEN 10 AND 20), page_limit INTEGER NOT NULL, retry_policy_json TEXT NOT NULL, replacement_policy_json TEXT NOT NULL, allowed_failure_reason_codes_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS study_campaign_sites (campaign_id TEXT NOT NULL REFERENCES study_campaigns(id) ON DELETE RESTRICT, slot INTEGER NOT NULL, candidate_id TEXT NOT NULL, site_id TEXT REFERENCES sites(id) ON DELETE RESTRICT, replacement_rank INTEGER NOT NULL, category TEXT NOT NULL, planned_reason TEXT NOT NULL, PRIMARY KEY(campaign_id,slot,replacement_rank), UNIQUE(campaign_id,candidate_id));
    CREATE TABLE IF NOT EXISTS study_run_attempts (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES study_campaigns(id) ON DELETE RESTRICT, slot INTEGER NOT NULL, candidate_id TEXT NOT NULL, replacement_rank INTEGER NOT NULL, attempt_no INTEGER NOT NULL, run_id TEXT REFERENCES scan_runs(id) ON DELETE RESTRICT, trigger TEXT NOT NULL, terminal_status TEXT NOT NULL, usability_decision TEXT NOT NULL, decision_reason_code TEXT, started_at TEXT NOT NULL, completed_at TEXT, UNIQUE(campaign_id,slot,attempt_no), UNIQUE(campaign_id,run_id));
    CREATE TABLE IF NOT EXISTS study_freezes (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL UNIQUE REFERENCES study_campaigns(id) ON DELETE RESTRICT, attempt_log_hash TEXT NOT NULL, freeze_digest TEXT NOT NULL UNIQUE, protocol_hash TEXT NOT NULL, sample_frame_hash TEXT NOT NULL, execution_log_hash TEXT NOT NULL, scanner_version TEXT NOT NULL, axe_version TEXT NOT NULL, model_version TEXT NOT NULL, run_set_hash TEXT NOT NULL, population_digest TEXT NOT NULL, eligible_population_count INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS study_exports (id TEXT PRIMARY KEY, study_freeze_id TEXT NOT NULL REFERENCES study_freezes(id) ON DELETE RESTRICT, kind TEXT NOT NULL, source_export_id TEXT REFERENCES study_exports(id) ON DELETE RESTRICT, revision INTEGER NOT NULL, outcome_digest TEXT, supersedes_export_id TEXT REFERENCES study_exports(id) ON DELETE RESTRICT, is_current INTEGER NOT NULL DEFAULT 0, run_set_hash TEXT NOT NULL, status TEXT NOT NULL, storage_relpath TEXT NOT NULL, manifest_hash TEXT, publication_status TEXT NOT NULL DEFAULT 'unpublished', publication_revision INTEGER NOT NULL DEFAULT 0, publication_scope_hash TEXT, publication_gate_bundle_hash TEXT, publication_commit TEXT, publication_attestation_hash TEXT, publication_error TEXT, created_at TEXT NOT NULL, verified_at TEXT);
    CREATE TABLE IF NOT EXISTS study_export_runs (export_id TEXT NOT NULL REFERENCES study_exports(id) ON DELETE RESTRICT, run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT, ordinal INTEGER NOT NULL, PRIMARY KEY(export_id,run_id), UNIQUE(export_id,ordinal));
    CREATE TABLE IF NOT EXISTS manual_review_batches (id TEXT PRIMARY KEY, study_freeze_id TEXT NOT NULL REFERENCES study_freezes(id) ON DELETE RESTRICT, source_export_id TEXT NOT NULL REFERENCES study_exports(id) ON DELETE RESTRICT, source_manifest_hash TEXT NOT NULL, population_digest TEXT NOT NULL, algorithm_version TEXT NOT NULL, seed TEXT NOT NULL, target_size INTEGER NOT NULL, population_size INTEGER NOT NULL, strata_config_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS manual_review_samples (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES manual_review_batches(id) ON DELETE RESTRICT, result_node_id TEXT NOT NULL REFERENCES result_nodes(id) ON DELETE RESTRICT, result_type TEXT NOT NULL, effective_impact TEXT, rule_id TEXT NOT NULL, stratum TEXT NOT NULL, draw_order INTEGER NOT NULL, selected_at TEXT NOT NULL, UNIQUE(batch_id,result_node_id), UNIQUE(batch_id,draw_order));
    CREATE TABLE IF NOT EXISTS manual_reviews (id TEXT PRIMARY KEY, result_node_id TEXT NOT NULL REFERENCES result_nodes(id) ON DELETE RESTRICT, sample_id TEXT REFERENCES manual_review_samples(id) ON DELETE RESTRICT, review_context TEXT NOT NULL, reviewer TEXT NOT NULL, verdict TEXT NOT NULL, note TEXT NOT NULL, revision INTEGER NOT NULL, supersedes_review_id TEXT REFERENCES manual_reviews(id) ON DELETE RESTRICT, is_current INTEGER NOT NULL DEFAULT 1, reviewed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS manual_review_adjudications (id TEXT PRIMARY KEY, sample_id TEXT NOT NULL REFERENCES manual_review_samples(id) ON DELETE RESTRICT, adjudicated_verdict TEXT NOT NULL, resolution_note TEXT NOT NULL, resolution_hash TEXT NOT NULL, revision INTEGER NOT NULL, supersedes_adjudication_id TEXT REFERENCES manual_review_adjudications(id) ON DELETE RESTRICT, status TEXT NOT NULL, proposed_by TEXT NOT NULL, approved_by TEXT, proposed_at TEXT NOT NULL, approved_at TEXT, is_current INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS review_freezes (id TEXT PRIMARY KEY, study_freeze_id TEXT NOT NULL REFERENCES study_freezes(id) ON DELETE RESTRICT, batch_id TEXT NOT NULL REFERENCES manual_review_batches(id) ON DELETE RESTRICT, revision INTEGER NOT NULL, review_set_hash TEXT NOT NULL, adjudication_set_hash TEXT NOT NULL, artifact_hash TEXT NOT NULL, storage_relpath TEXT NOT NULL, status TEXT NOT NULL, supersedes_review_freeze_id TEXT REFERENCES review_freezes(id) ON DELETE RESTRICT, is_current INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, verified_at TEXT);
    CREATE TABLE IF NOT EXISTS human_gate_evidence (id TEXT PRIMARY KEY, gate_id TEXT NOT NULL, campaign_id TEXT, role TEXT NOT NULL, decision TEXT NOT NULL, statement_version TEXT NOT NULL, bound_commit TEXT, artifacts_json TEXT NOT NULL, note TEXT NOT NULL, revision INTEGER NOT NULL, supersedes_evidence_id TEXT REFERENCES human_gate_evidence(id) ON DELETE RESTRICT, is_current INTEGER NOT NULL DEFAULT 1, reviewed_at TEXT NOT NULL, receipt_hash TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS human_gate_evidence_outbox (id TEXT PRIMARY KEY, evidence_id TEXT NOT NULL UNIQUE REFERENCES human_gate_evidence(id) ON DELETE RESTRICT, target_relpath TEXT NOT NULL, receipt_json TEXT NOT NULL, expected_file_hash TEXT NOT NULL, status TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, written_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_study_exports_current ON study_exports(study_freeze_id,kind,is_current);
    CREATE INDEX IF NOT EXISTS idx_manual_reviews_current ON manual_reviews(result_node_id,reviewer,review_context,is_current);
  `);
  addColumn("study_exports", "published_at", "TEXT");
  addColumn("study_exports", "withdrawn_at", "TEXT");
  addColumn("study_exports", "release_started_at", "TEXT");
  addColumn("study_exports", "release_finished_at", "TEXT");
}

function migration003(db: Database.Database) {
  const exists = (db.prepare("PRAGMA table_info(pages)").all() as any[]).some(
    (row) => row.name === "title",
  );
  if (!exists) db.exec("ALTER TABLE pages ADD COLUMN title TEXT");
}

function migration004(db: Database.Database) {
  const exists = (db.prepare("PRAGMA table_info(human_gate_evidence)").all() as any[]).some(
    (row) => row.name === "campaign_id",
  );
  if (!exists) db.exec("ALTER TABLE human_gate_evidence ADD COLUMN campaign_id TEXT");
  for (const [column, definition] of [
    ["published_at", "TEXT"],
    ["withdrawn_at", "TEXT"],
    ["release_started_at", "TEXT"],
    ["release_finished_at", "TEXT"],
  ] as const) {
    const present = (db.prepare("PRAGMA table_info(study_exports)").all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE study_exports ADD COLUMN ${column} ${definition}`);
  }
}

function migration005(db: Database.Database) {
  for (const [column, definition] of [
    ["frame_total", "INTEGER NOT NULL DEFAULT 0"],
    ["same_origin_frame_total", "INTEGER NOT NULL DEFAULT 0"],
    ["cross_origin_frame_total", "INTEGER NOT NULL DEFAULT 0"],
    ["frame_tested_total", "INTEGER NOT NULL DEFAULT 0"],
    ["frame_skipped_total", "INTEGER NOT NULL DEFAULT 0"],
    ["frame_error_count", "INTEGER NOT NULL DEFAULT 0"],
    ["frame_coverage_status", "TEXT NOT NULL DEFAULT 'no_child_frames'"],
  ] as const) {
    const present = (db.prepare("PRAGMA table_info(pages)").all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE pages ADD COLUMN ${column} ${definition}`);
  }
  for (const [column, definition] of [
    ["published_at", "TEXT"],
    ["withdrawn_at", "TEXT"],
    ["release_started_at", "TEXT"],
    ["release_finished_at", "TEXT"],
  ] as const) {
    const present = (db.prepare("PRAGMA table_info(study_exports)").all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE study_exports ADD COLUMN ${column} ${definition}`);
  }
}

function migration006(db: Database.Database) {
  for (const [column, definition] of [
    ["frame_total", "INTEGER NOT NULL DEFAULT 0"],
    ["same_origin_frame_total", "INTEGER NOT NULL DEFAULT 0"],
    ["cross_origin_frame_total", "INTEGER NOT NULL DEFAULT 0"],
    ["frame_tested_total", "INTEGER NOT NULL DEFAULT 0"],
    ["frame_skipped_total", "INTEGER NOT NULL DEFAULT 0"],
    ["frame_error_count", "INTEGER NOT NULL DEFAULT 0"],
    ["frame_coverage_status", "TEXT NOT NULL DEFAULT 'no_child_frames'"],
  ] as const) {
    const present = (db.prepare("PRAGMA table_info(pages)").all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE pages ADD COLUMN ${column} ${definition}`);
  }
}

function migration007(db: Database.Database) {
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_jobs_idempotency ON scan_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL",
  );
  const add = (table: string, column: string, definition: string) => {
    const present = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  for (const column of [
    "source_manifest_hash",
    "review_freeze_hash",
    "report_localization_hash",
    "model_decision_hash",
    "model_observations_hash",
    "r4_evidence_bundle_hash",
  ])
    add("study_exports", column, "TEXT");
  for (const column of [
    "review_freeze_id",
    "review_freeze_hash",
    "report_localization_hash",
    "r4_evidence_bundle_hash",
    "final_verified_at",
  ])
    add("study_freezes", column, "TEXT");
  add("human_gate_evidence", "artifact_bundle_hash", "TEXT");
}

function migration008(db: Database.Database) {
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_jobs_idempotency ON scan_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_scan_jobs_status_created ON scan_jobs(status,created_at)",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_job_pages_lease ON job_pages(status,lease_expires_at)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_job_pages_job_status_lease ON job_pages(job_id,status,lease_expires_at)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_scan_runs_published ON scan_runs(published,published_at)",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_pages_run_status ON pages(run_id,scan_status)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_study_freezes_digest_status ON study_freezes(freeze_digest,status)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_study_exports_status ON study_exports(study_freeze_id,kind,status)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_study_exports_publication ON study_exports(kind,status,is_current,publication_status)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_study_exports_gate ON study_exports(publication_status,publication_gate_bundle_hash,publication_commit,publication_attestation_hash)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_manual_samples_stratum ON manual_review_samples(batch_id,stratum,draw_order)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_manual_reviews_reviewed ON manual_reviews(result_node_id,reviewed_at)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_adjudications_current ON manual_review_adjudications(sample_id,is_current)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_review_freezes_current ON review_freezes(study_freeze_id,is_current)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_gate_evidence_current ON human_gate_evidence(gate_id,role,is_current)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_gate_outbox_status ON human_gate_evidence_outbox(status,created_at)",
  );
}

function migration009(db: Database.Database) {
  // Keep only the newest current evidence per gate/role before adding the invariant.
  db.exec(`
    UPDATE human_gate_evidence
    SET is_current=0
    WHERE is_current=1 AND id NOT IN (
      SELECT (
        SELECT winner.id FROM human_gate_evidence winner
        WHERE winner.gate_id=grouped.gate_id AND winner.role=grouped.role AND winner.is_current=1
        ORDER BY winner.revision DESC,winner.reviewed_at DESC,winner.id DESC LIMIT 1
      )
      FROM human_gate_evidence grouped
      WHERE grouped.is_current=1
      GROUP BY grouped.gate_id,grouped.role
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gate_evidence_current_unique
      ON human_gate_evidence(gate_id,role) WHERE is_current=1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_review_batches_source_unique
      ON manual_review_batches(study_freeze_id,source_export_id,algorithm_version);
  `);
}

function migration010(db: Database.Database) {
  const present = (db.prepare("PRAGMA table_info(sites)").all() as any[]).some(
    (row) => row.name === "candidate_id",
  );
  if (!present) db.exec("ALTER TABLE sites ADD COLUMN candidate_id TEXT");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_candidate_id ON sites(candidate_id) WHERE candidate_id IS NOT NULL",
  );
}

function migration011(db: Database.Database) {
  const add = (column: string, definition: string) => {
    const present = (db.prepare("PRAGMA table_info(scan_jobs)").all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE scan_jobs ADD COLUMN ${column} ${definition}`);
  };
  add("study_campaign_id", "TEXT");
  add("study_slot", "INTEGER");
  add("study_candidate_id", "TEXT");
  add("study_replacement_rank", "INTEGER");
  add("study_attempt_no", "INTEGER");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_scan_jobs_study_context ON scan_jobs(study_campaign_id,study_slot,study_replacement_rank)",
  );
}

function migration012(db: Database.Database) {
  const add = (column: string, definition: string) => {
    const present = (db.prepare("PRAGMA table_info(study_exports)").all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE study_exports ADD COLUMN ${column} ${definition}`);
  };
  add("privacy_check_hash", "TEXT");
  add("file_allowlist_hash", "TEXT");
  add("validation_attestation_hash", "TEXT");
  add("build_attestation_hash", "TEXT");
  add("publication_statement_version", "TEXT");
}

function migration013(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS r5_sessions (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('computer_lead','math_lead')),
      bound_commit TEXT NOT NULL,
      exercise_json TEXT,
      understanding_json TEXT,
      handoff_json TEXT,
      exercise_hash TEXT,
      understanding_hash TEXT,
      handoff_hash TEXT,
      status TEXT NOT NULL DEFAULT 'started',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finalized_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_r5_sessions_role_commit ON r5_sessions(role,bound_commit);
    CREATE INDEX IF NOT EXISTS idx_r5_sessions_status ON r5_sessions(status,updated_at);
  `);
}

function migration014(db: Database.Database) {
  db.exec(`
    UPDATE study_exports
    SET is_current=0
    WHERE is_current=1 AND id NOT IN (
      SELECT MAX(id) FROM study_exports WHERE is_current=1 GROUP BY study_freeze_id,kind
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_study_exports_current_unique
      ON study_exports(study_freeze_id,kind) WHERE is_current=1;
  `);
}

function migration015(db: Database.Database) {
  const present = (db.prepare("PRAGMA table_info(scan_runs)").all() as any[]).some(
    (row) => row.name === "scan_time_localization_hash",
  );
  if (!present) db.exec("ALTER TABLE scan_runs ADD COLUMN scan_time_localization_hash TEXT");
}

function migration016(db: Database.Database) {
  const present = (db.prepare("PRAGMA table_info(pages)").all() as any[]).some(
    (row) => row.name === "frame_coverage_issues_json",
  );
  if (!present)
    db.exec("ALTER TABLE pages ADD COLUMN frame_coverage_issues_json TEXT NOT NULL DEFAULT '[]'");
}

function migration017(db: Database.Database) {
  const add = (table: string, column: string, definition: string) => {
    const present = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  add("pages", "axe_timestamp", "TEXT");
  add("pages", "axe_test_engine_json", "TEXT");
  add("pages", "axe_test_environment_json", "TEXT");
  add("pages", "axe_tool_options_json", "TEXT");
}

export type Db = Database.Database;
