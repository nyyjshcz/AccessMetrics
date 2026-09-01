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
    migration018,
    migration019,
    migration020,
    migration021,
    migration022,
    migration023,
    migration024,
    migration025,
    migration026,
    migration027,
    migration028,
    migration029,
    migration030,
    migration031,
  ];
  for (let index = 0; index < migrations.length; index++) {
    const version = index + 1;
    if (applied.has(version)) continue;
    // Migration 021 rebuilds the legacy pages table to remove the original
    // site-wide UNIQUE(site_id, canonical_url) constraint. SQLite cannot drop
    // that auto-index in place, and the rebuild must temporarily disable FK
    // enforcement while child tables continue to reference the same name.
    const legacyPagesRebuild = version === 21 && hasLegacyPagesUniqueConstraint(db);
    if (legacyPagesRebuild) db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        migrations[index](db);
        db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
          version,
          new Date().toISOString(),
        );
      })();
    } finally {
      if (legacyPagesRebuild) db.pragma("foreign_keys = ON");
    }
    logger.info({ version }, "database migration applied");
  }
}

function hasLegacyPagesUniqueConstraint(db: Database.Database) {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pages'")
    .get() as { sql?: string } | undefined;
  return Boolean(row?.sql && /UNIQUE\s*\(\s*site_id\s*,\s*canonical_url\s*\)/i.test(row.sql));
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
      first_seen_at TEXT NOT NULL
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

function migration018(db: Database.Database) {
  const addColumn = (table: string, column: string, definition: string) => {
    const present = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };

  // These columns make the page identity belong to one job/run instead of
  // reusing a site-wide URL row across separate scans.  Existing rows remain
  // readable; new discovery writes the linkage atomically.
  addColumn("scan_jobs", "max_pages", "INTEGER");
  addColumn("scan_runs", "created_at", "TEXT");
  addColumn("pages", "job_page_id", "TEXT");
  addColumn("pages", "created_at", "TEXT");
  addColumn("job_pages", "id", "TEXT");

  addColumn("result_nodes", "frame_url", "TEXT");
  addColumn("result_nodes", "frame_origin_relation", "TEXT");

  for (const [column, definition] of [
    ["total_score", "REAL"],
    ["total_score_tenths", "INTEGER"],
    ["total_numerator", "INTEGER"],
    ["total_denominator", "INTEGER"],
    ["perceivable_score", "REAL"],
    ["perceivable_score_tenths", "INTEGER"],
    ["perceivable_numerator", "INTEGER"],
    ["perceivable_denominator", "INTEGER"],
    ["operable_score", "REAL"],
    ["operable_score_tenths", "INTEGER"],
    ["operable_numerator", "INTEGER"],
    ["operable_denominator", "INTEGER"],
    ["understandable_score", "REAL"],
    ["understandable_score_tenths", "INTEGER"],
    ["understandable_numerator", "INTEGER"],
    ["understandable_denominator", "INTEGER"],
    ["robust_score", "REAL"],
    ["robust_score_tenths", "INTEGER"],
    ["robust_numerator", "INTEGER"],
    ["robust_denominator", "INTEGER"],
    ["created_at", "TEXT"],
  ] as const) {
    addColumn("page_scores", column, definition);
    addColumn("site_scores", column, definition);
  }
  addColumn("page_scores", "score_details_json", "TEXT");
  addColumn("site_scores", "score_details_json", "TEXT");

  db.exec(`
    UPDATE scan_jobs
    SET max_pages=COALESCE(max_pages, CAST(json_extract(options_json,'$.maxPages') AS INTEGER));
    UPDATE scan_runs SET created_at=COALESCE(created_at, started_at);
    UPDATE pages SET created_at=COALESCE(created_at, first_seen_at);
    UPDATE job_pages SET id=COALESCE(id, 'jp_' || lower(hex(randomblob(16))));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_run_normalized
      ON pages(run_id, normalized_url) WHERE run_id IS NOT NULL AND normalized_url IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_job_page_unique
      ON pages(job_page_id) WHERE job_page_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_pages_id_unique
      ON job_pages(id) WHERE id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_pages_discovery_order
      ON job_pages(job_id, discovery_order);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_pages_normalized_url
      ON job_pages(job_id, normalized_url);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_result_nodes_target
      ON result_nodes(rule_result_id, target_hash) WHERE target_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_page_scores_page_model
      ON page_scores(page_id, model_version);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_site_scores_run_model
      ON site_scores(run_id, model_version);
  `);
}

function migration019(db: Database.Database) {
  const addColumn = (table: string, column: string, definition: string) => {
    const present = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  // Older databases created before the score-details columns were introduced
  // must be upgraded explicitly; migration018 may already be recorded.
  addColumn("page_scores", "score_details_json", "TEXT");
  addColumn("site_scores", "score_details_json", "TEXT");
}

function migration020(db: Database.Database) {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_pages_normalized_url
      ON job_pages(job_id, normalized_url);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_runs_job_unique
      ON scan_runs(job_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_reviews_current_unique
      ON manual_reviews(sample_id, reviewer, review_context) WHERE is_current=1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_adjudications_current_unique
      ON manual_review_adjudications(sample_id) WHERE is_current=1;
  `);
}

function migration021(db: Database.Database) {
  if (!hasLegacyPagesUniqueConstraint(db)) return;
  db.exec(`
    CREATE TABLE pages_rebuilt (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
      canonical_url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      run_id TEXT,
      requested_url TEXT,
      final_url TEXT,
      normalized_url TEXT,
      crawl_depth INTEGER NOT NULL DEFAULT 0,
      discovered_from_url TEXT,
      http_status INTEGER,
      content_type TEXT,
      load_ms INTEGER,
      scan_status TEXT NOT NULL DEFAULT 'success',
      error_code TEXT,
      error_message TEXT,
      title TEXT,
      frame_total INTEGER NOT NULL DEFAULT 0,
      same_origin_frame_total INTEGER NOT NULL DEFAULT 0,
      cross_origin_frame_total INTEGER NOT NULL DEFAULT 0,
      frame_tested_total INTEGER NOT NULL DEFAULT 0,
      frame_skipped_total INTEGER NOT NULL DEFAULT 0,
      frame_error_count INTEGER NOT NULL DEFAULT 0,
      frame_coverage_status TEXT NOT NULL DEFAULT 'no_child_frames',
      frame_coverage_issues_json TEXT NOT NULL DEFAULT '[]',
      axe_timestamp TEXT,
      axe_test_engine_json TEXT,
      axe_test_environment_json TEXT,
      axe_tool_options_json TEXT,
      job_page_id TEXT,
      created_at TEXT
    );
    INSERT INTO pages_rebuilt(
      id,site_id,canonical_url,first_seen_at,run_id,requested_url,final_url,
      normalized_url,crawl_depth,discovered_from_url,http_status,content_type,
      load_ms,scan_status,error_code,error_message,title,frame_total,
      same_origin_frame_total,cross_origin_frame_total,frame_tested_total,
      frame_skipped_total,frame_error_count,frame_coverage_status,
      frame_coverage_issues_json,axe_timestamp,axe_test_engine_json,
      axe_test_environment_json,axe_tool_options_json,job_page_id,created_at
    )
    SELECT
      id,site_id,canonical_url,first_seen_at,run_id,requested_url,final_url,
      normalized_url,crawl_depth,discovered_from_url,http_status,content_type,
      load_ms,scan_status,error_code,error_message,title,frame_total,
      same_origin_frame_total,cross_origin_frame_total,frame_tested_total,
      frame_skipped_total,frame_error_count,frame_coverage_status,
      frame_coverage_issues_json,axe_timestamp,axe_test_engine_json,
      axe_test_environment_json,axe_tool_options_json,job_page_id,created_at
    FROM pages;
    DROP TABLE pages;
    ALTER TABLE pages_rebuilt RENAME TO pages;
    CREATE INDEX IF NOT EXISTS idx_pages_run_status ON pages(run_id,scan_status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_run_normalized
      ON pages(run_id, normalized_url) WHERE run_id IS NOT NULL AND normalized_url IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_job_page_unique
      ON pages(job_page_id) WHERE job_page_id IS NOT NULL;
  `);
}

function migration022(db: Database.Database) {
  const addColumn = (column: string, definition: string) => {
    const present = (db.prepare("PRAGMA table_info(r5_sessions)").all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE r5_sessions ADD COLUMN ${column} ${definition}`);
  };
  addColumn("exercise_revision", "INTEGER NOT NULL DEFAULT 0");
  addColumn("exercise_status", "TEXT NOT NULL DEFAULT 'not_started'");
  addColumn("exercise_bound_tree_hash", "TEXT");
  addColumn("exercise_environment_hash", "TEXT");
  addColumn("exercise_index_hash", "TEXT");
  addColumn("exercise_catalog_hash", "TEXT");
  addColumn("exercise_root", "TEXT");
  addColumn("exercise_steps_json", "TEXT");
  addColumn("exercise_observations_json", "TEXT");
  addColumn("exercise_artifact_path", "TEXT");
  addColumn("understanding_artifact_path", "TEXT");
  addColumn("handoff_artifact_path", "TEXT");
  addColumn("understanding_revision", "INTEGER NOT NULL DEFAULT 0");
  addColumn("understanding_status", "TEXT NOT NULL DEFAULT 'not_started'");
  addColumn("handoff_revision", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS r5_artifact_outbox (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES r5_sessions(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK(kind IN ('exercise','understanding','handoff')),
      target_relpath TEXT NOT NULL UNIQUE,
      artifact_json TEXT NOT NULL,
      expected_file_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      written_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_r5_artifact_outbox_status
      ON r5_artifact_outbox(status,created_at);
  `);
}

function migration023(db: Database.Database) {
  const present = (db.prepare("PRAGMA table_info(study_run_attempts)").all() as any[]).some(
    (row) => row.name === "replacement_activated_at",
  );
  if (!present) db.exec("ALTER TABLE study_run_attempts ADD COLUMN replacement_activated_at TEXT");
}

function migration024(db: Database.Database) {
  // The R5 session table remains as a compatibility/read-model for the first
  // implementation, while these normalized tables are the durable contract
  // used by the gate, outbox recovery and database checks.
  db.exec(`
    CREATE TABLE IF NOT EXISTS r5_artifact_outbox (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES r5_sessions(id) ON DELETE RESTRICT,
      kind TEXT NOT NULL CHECK(kind IN ('exercise','understanding','handoff')),
      target_relpath TEXT NOT NULL UNIQUE,
      artifact_json TEXT NOT NULL,
      expected_file_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      written_at TEXT
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_job_pages_job_status_discovery
      ON job_pages(job_id,status,discovery_order);
    CREATE INDEX IF NOT EXISTS idx_rule_results_page_type_rule
      ON rule_results(page_id,result_type,rule_id);
    CREATE INDEX IF NOT EXISTS idx_study_export_runs_export_ordinal
      ON study_export_runs(export_id,ordinal);
    CREATE TABLE IF NOT EXISTS r5_owner_artifacts (
      id TEXT PRIMARY KEY,
      artifact_type TEXT NOT NULL CHECK(artifact_type IN ('exercise','understanding','handoff')),
      role TEXT NOT NULL CHECK(role IN ('computer_lead','math_lead')),
      bound_rc_commit TEXT NOT NULL,
      bound_tree_hash TEXT,
      r1_r4_index_hash TEXT NOT NULL,
      catalog_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','passed','rejected','invalidated')),
      payload_json TEXT NOT NULL,
      artifact_hash TEXT,
      revision INTEGER NOT NULL,
      supersedes_artifact_id TEXT REFERENCES r5_owner_artifacts(id) ON DELETE RESTRICT,
      is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
      created_at TEXT NOT NULL,
      finalized_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_r5_owner_artifacts_revision
      ON r5_owner_artifacts(artifact_type,role,revision);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_r5_owner_artifacts_current_unique
      ON r5_owner_artifacts(artifact_type,role) WHERE is_current=1;
    CREATE TABLE IF NOT EXISTS r5_exercise_steps (
      artifact_id TEXT NOT NULL REFERENCES r5_owner_artifacts(id) ON DELETE RESTRICT,
      step_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','passed','failed')),
      exit_code INTEGER,
      output_sha256 TEXT,
      stdout_sha256 TEXT,
      stderr_sha256 TEXT,
      observation TEXT,
      completed_at TEXT,
      PRIMARY KEY(artifact_id,step_id)
    );
    CREATE TABLE IF NOT EXISTS r5_artifact_bundles (
      id TEXT PRIMARY KEY,
      rc_commit TEXT NOT NULL,
      r1_r4_index_hash TEXT NOT NULL,
      computer_exercise_hash TEXT NOT NULL,
      computer_understanding_hash TEXT NOT NULL,
      computer_handoff_hash TEXT NOT NULL,
      math_exercise_hash TEXT NOT NULL,
      math_understanding_hash TEXT NOT NULL,
      math_handoff_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ready','consumed','invalidated')),
      bundle_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_r5_owner_artifacts_role_type_current_status
      ON r5_owner_artifacts(role,artifact_type,is_current,status);
    CREATE INDEX IF NOT EXISTS idx_r5_exercise_steps_artifact_status
      ON r5_exercise_steps(artifact_id,status);
    CREATE INDEX IF NOT EXISTS idx_r5_artifact_bundles_commit_status
      ON r5_artifact_bundles(rc_commit,status);
    CREATE INDEX IF NOT EXISTS idx_r5_artifact_outbox_status_only
      ON r5_artifact_outbox(status);
  `);
  const addColumn = (column: string, definition: string) => {
    const present = (db.prepare("PRAGMA table_info(r5_artifact_outbox)").all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE r5_artifact_outbox ADD COLUMN ${column} ${definition}`);
  };
  addColumn("artifact_kind", "TEXT");
  addColumn("artifact_id", "TEXT");
  addColumn("canonical_json", "TEXT");
  db.exec(`
    UPDATE r5_artifact_outbox
    SET artifact_kind=CASE WHEN kind IN ('exercise','understanding','handoff') THEN 'owner_artifact' ELSE 'bundle' END,
        artifact_id=COALESCE(artifact_id,session_id),
        canonical_json=COALESCE(canonical_json,artifact_json)
    WHERE artifact_kind IS NULL OR canonical_json IS NULL;
  `);
}

function migration025(db: Database.Database) {
  // 024 added the normalized columns to the compatibility outbox. Rebuild it
  // once so the production contract is the plan's polymorphic artifact/bundle
  // outbox rather than the legacy session/kind read-model.
  db.exec(`
    CREATE TABLE IF NOT EXISTS r5_artifact_outbox_v25 (
      id TEXT PRIMARY KEY,
      artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('owner_artifact','bundle')),
      artifact_id TEXT NOT NULL,
      target_relpath TEXT NOT NULL,
      canonical_json TEXT NOT NULL,
      expected_file_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','written','failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      written_at TEXT
    );
    INSERT INTO r5_artifact_outbox_v25(
      id,artifact_kind,artifact_id,target_relpath,canonical_json,expected_file_hash,
      status,attempt_count,last_error,created_at,written_at
    )
    SELECT
      id,
      COALESCE(artifact_kind,CASE WHEN kind IN ('exercise','understanding','handoff') THEN 'owner_artifact' ELSE 'bundle' END),
      COALESCE(artifact_id,session_id),
      target_relpath,
      COALESCE(canonical_json,artifact_json),
      expected_file_hash,
      status,
      attempt_count,
      last_error,
      created_at,
      written_at
    FROM r5_artifact_outbox;
    DROP TABLE r5_artifact_outbox;
    ALTER TABLE r5_artifact_outbox_v25 RENAME TO r5_artifact_outbox;
    CREATE INDEX IF NOT EXISTS idx_r5_artifact_outbox_status_only
      ON r5_artifact_outbox(status);
    CREATE INDEX IF NOT EXISTS idx_r5_artifact_outbox_status
      ON r5_artifact_outbox(status,created_at);
  `);
}

function migration026(db: Database.Database) {
  // Formal reviews have a non-null sample_id and are covered by the v20
  // partial uniqueness invariant. Ad-hoc reviews have NULL sample_id, which
  // SQLite treats as distinct in a unique index. Reconcile any historical
  // duplicate current ad-hoc rows before enforcing the equivalent invariant.
  db.exec(`
    UPDATE manual_reviews
    SET is_current=0
    WHERE sample_id IS NULL
      AND review_context='ad_hoc'
      AND is_current=1
      AND id NOT IN (
        SELECT winner.id
        FROM manual_reviews AS winner
        WHERE winner.sample_id IS NULL
          AND winner.review_context='ad_hoc'
          AND winner.is_current=1
          AND winner.result_node_id=manual_reviews.result_node_id
          AND winner.reviewer=manual_reviews.reviewer
        ORDER BY winner.revision DESC,winner.reviewed_at DESC,winner.id DESC
        LIMIT 1
      );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_reviews_ad_hoc_current_unique
      ON manual_reviews(result_node_id,reviewer,review_context)
      WHERE is_current=1 AND sample_id IS NULL AND review_context='ad_hoc';
  `);
}

function migration027(db: Database.Database) {
  const addColumn = (table: string, column: string, definition: string) => {
    const present = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };

  addColumn("result_nodes", "ai_evidence_json", "TEXT");
  addColumn("result_nodes", "ai_evidence_hash", "TEXT");
  addColumn("result_nodes", "ai_evidence_version", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_provider_configs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT,
      key_fingerprint TEXT NOT NULL DEFAULT '',
      max_concurrent_requests INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_review_batches (
      id TEXT PRIMARY KEY,
      batch_key TEXT NOT NULL UNIQUE,
      run_id TEXT REFERENCES scan_runs(id) ON DELETE RESTRICT,
      page_id TEXT REFERENCES pages(id) ON DELETE RESTRICT,
      study_freeze_id TEXT REFERENCES study_freezes(id) ON DELETE RESTRICT,
      provider_config_id TEXT NOT NULL REFERENCES ai_provider_configs(id) ON DELETE RESTRICT,
      provider_snapshot_json TEXT NOT NULL,
      provider_snapshot_hash TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      evidence_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','paused','completed','failed','cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      CHECK (
        (study_freeze_id IS NOT NULL AND run_id IS NULL AND page_id IS NULL)
        OR (study_freeze_id IS NULL AND run_id IS NOT NULL)
      )
    );
    CREATE TABLE IF NOT EXISTS ai_review_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES ai_review_batches(id) ON DELETE RESTRICT,
      result_node_id TEXT NOT NULL REFERENCES result_nodes(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
      verdict TEXT CHECK(verdict IN ('problem','not_problem','uncertain') OR verdict IS NULL),
      reason TEXT,
      evidence_hash TEXT,
      lease_owner TEXT,
      lease_until TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      response_hash TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(batch_id,result_node_id),
      CHECK(status <> 'completed' OR verdict IS NOT NULL)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_formal_batch_study_freeze
      ON ai_review_batches(study_freeze_id)
      WHERE study_freeze_id IS NOT NULL AND run_id IS NULL AND page_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_ai_batches_scope
      ON ai_review_batches(run_id,page_id,study_freeze_id,status,updated_at);
    CREATE INDEX IF NOT EXISTS idx_ai_items_status_lease
      ON ai_review_items(status,lease_until,updated_at);
    CREATE INDEX IF NOT EXISTS idx_ai_items_batch
      ON ai_review_items(batch_id,status,result_node_id);
    CREATE INDEX IF NOT EXISTS idx_ai_items_node
      ON ai_review_items(result_node_id,status,updated_at);
  `);
}

function migration028(db: Database.Database) {
  const addColumn = (table: string, column: string, definition: string) => {
    const present = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some(
      (row) => row.name === column,
    );
    if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  // A study freeze must carry the exact scan-time rule catalog identity used
  // by its canonical runs. Historical freezes remain readable but cannot be
  // treated as catalog-complete until recreated.
  addColumn("study_freezes", "catalog_version", "TEXT");
  addColumn("study_freezes", "rule_catalog_hash", "TEXT");
}

function migration029(db: Database.Database) {
  const hasColumn = (db.prepare("PRAGMA table_info(ai_provider_configs)").all() as any[]).some(
    (row) => row.name === "max_concurrent_requests",
  );
  if (!hasColumn)
    db.exec(
      "ALTER TABLE ai_provider_configs ADD COLUMN max_concurrent_requests INTEGER NOT NULL DEFAULT 1",
    );
  db.prepare(
    "UPDATE ai_provider_configs SET max_concurrent_requests=1 WHERE max_concurrent_requests IS NULL OR max_concurrent_requests<1",
  ).run();
}

function migration030(db: Database.Database) {
  const hasColumn = (db.prepare("PRAGMA table_info(ai_provider_configs)").all() as any[]).some(
    (row) => row.name === "rate_limit_rpm",
  );
  if (!hasColumn)
    db.exec(
      "ALTER TABLE ai_provider_configs ADD COLUMN rate_limit_rpm INTEGER NOT NULL DEFAULT 0",
    );
  // Existing OpenRouter free providers already used the built-in 20 RPM pace;
  // preserve that behavior while making the strategy optional for future edits.
  db.exec(`
    UPDATE ai_provider_configs
    SET rate_limit_rpm=20
    WHERE rate_limit_rpm=0
      AND lower(base_url) LIKE 'https://openrouter.ai%'
      AND (lower(trim(model)) LIKE '%:free' OR lower(trim(model))='openrouter/free')
  `);
}

function migration031(db: Database.Database) {
  const present = (db.prepare("PRAGMA table_info(scan_runs)").all() as any[]).some(
    (row) => row.name === "crawl_summary_json",
  );
  if (!present) db.exec("ALTER TABLE scan_runs ADD COLUMN crawl_summary_json TEXT");
}

export type Db = Database.Database;
