import fs from "node:fs";
import path from "node:path";
import { getDb, transaction } from "./db";
import { config } from "./config";
import { id } from "./ids";
import { canonicalize, sha256 } from "./canonical";
import { exportRun } from "./export";
import { AppError } from "./errors";

export function createStudyExport(input: {
  studyFreezeId: string;
  kind: "study_source" | "study_final";
  expectedSourceExportId?: string | null;
  expectedOutcomeDigest?: string | null;
}) {
  const freeze = getDb()
    .prepare("SELECT * FROM study_freezes WHERE id=?")
    .get(input.studyFreezeId) as any;
  if (!freeze) throw new AppError("NOT_FOUND", "study freeze 不存在", 404);
  if (freeze.status !== "registered" && freeze.status !== "final_verified")
    throw new AppError("FREEZE_NOT_VERIFIED", "study freeze 状态不允许导出", 409);
  if (input.kind === "study_source" && freeze.status !== "registered")
    throw new AppError("SOURCE_FREEZE_STATE", "study_source 只能从 registered freeze 生成", 409);
  if (input.kind === "study_final" && freeze.status !== "final_verified")
    throw new AppError(
      "FINAL_FREEZE_STATE",
      "study_final 必须在 final_verified freeze 上生成",
      409,
    );
  const existing = getDb()
    .prepare(
      "SELECT * FROM study_exports WHERE study_freeze_id=? AND kind=? AND is_current=1 AND status='verified' ORDER BY revision DESC LIMIT 1",
    )
    .get(input.studyFreezeId, input.kind) as any;
  if (input.kind === "study_source" && existing) return existing;
  if (input.kind === "study_final") {
    if (!input.expectedSourceExportId)
      throw new AppError("SOURCE_REQUIRED", "study_final 必须引用 study_source", 422);
    const source = getDb()
      .prepare(
        "SELECT * FROM study_exports WHERE id=? AND study_freeze_id=? AND kind='study_source' AND status='verified'",
      )
      .get(input.expectedSourceExportId, input.studyFreezeId);
    if (!source) throw new AppError("SOURCE_MISMATCH", "source export 不匹配或未验证", 409);
    if (!(source as any).manifest_hash)
      throw new AppError("SOURCE_MANIFEST_MISSING", "source manifest hash 缺失", 409);
    const reviewFreeze = getDb()
      .prepare(
        "SELECT * FROM review_freezes WHERE study_freeze_id=? AND status='verified' AND is_current=1 ORDER BY revision DESC LIMIT 1",
      )
      .get(input.studyFreezeId) as any;
    if (!reviewFreeze)
      throw new AppError("REVIEW_FREEZE_REQUIRED", "R2/R3 review freeze 尚未验证", 409);
    const r4Evidence = getDb()
      .prepare(
        "SELECT COUNT(DISTINCT role) count FROM human_gate_evidence WHERE gate_id='R4' AND campaign_id=? AND decision='approved' AND is_current=1",
      )
      .get(freeze.campaign_id) as { count: number };
    if (r4Evidence.count < 2) throw new AppError("R4_REQUIRED", "两位负责人尚未通过 R4", 409);
  }
  const sourceRecord =
    input.kind === "study_final"
      ? (getDb()
          .prepare("SELECT * FROM study_exports WHERE id=?")
          .get(input.expectedSourceExportId) as any)
      : null;
  const attempts = getDb()
    .prepare(
      "SELECT slot,run_id FROM study_run_attempts WHERE campaign_id=? AND usability_decision='included' AND run_id IS NOT NULL ORDER BY slot,attempt_no",
    )
    .all(freeze.campaign_id) as Array<{ slot: number; run_id: string }>;
  const runs = [...new Map(attempts.map((attempt) => [attempt.slot, attempt])).values()];
  if (!runs.length) throw new AppError("NO_CANONICAL_RUNS", "没有 canonical run，不能导出", 409);
  const previous =
    input.kind === "study_final"
      ? (getDb()
          .prepare(
            "SELECT * FROM study_exports WHERE study_freeze_id=? AND kind='study_final' AND is_current=1 ORDER BY revision DESC LIMIT 1",
          )
          .get(input.studyFreezeId) as any)
      : null;
  const revision = previous ? previous.revision + 1 : 1;
  const exportId = id(input.kind === "study_source" ? "study-source" : "study-final");
  const target = path.join(config.privateEvidenceRoot, "study-exports", exportId);
  fs.mkdirSync(target, { recursive: true });
  const runIds = runs.map((row) => row.run_id as string);
  for (const runId of runIds) {
    const generated = exportRun(runId);
    const destination = path.join(target, "runs", runId);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ["scan.json", "issues.csv", "manifest.json", "manifest.sha256"]) {
      fs.copyFileSync(path.join(generated.target, file), path.join(destination, file));
    }
  }
  if (input.kind === "study_final") {
    const batch = getDb()
      .prepare(
        "SELECT * FROM manual_review_batches WHERE study_freeze_id=? AND status IN ('completed','completed_no_eligible_items')",
      )
      .get(input.studyFreezeId) as any;
    if (!batch) throw new AppError("REVIEWS_NOT_COMPLETE", "R2/R3 尚未完成，不能生成 final", 409);
    const reviews = getDb()
      .prepare(
        "SELECT mr.* FROM manual_reviews mr JOIN manual_review_samples ms ON ms.result_node_id=mr.result_node_id WHERE ms.batch_id=? ORDER BY mr.result_node_id,mr.revision",
      )
      .all(batch.id);
    fs.writeFileSync(path.join(target, "manual-reviews.json"), canonicalize(reviews) + "\n");
    const reviewFreeze = getDb()
      .prepare(
        "SELECT * FROM review_freezes WHERE study_freeze_id=? AND status='verified' AND is_current=1 ORDER BY revision DESC LIMIT 1",
      )
      .get(input.studyFreezeId) as any;
    if (!reviewFreeze || !fs.existsSync(reviewFreeze.storage_relpath))
      throw new AppError("REVIEW_FREEZE_MISSING", "review-freeze artifact 缺失", 409);
    fs.copyFileSync(reviewFreeze.storage_relpath, path.join(target, "review-freeze.json"));
  }
  const reviewFreeze =
    input.kind === "study_final"
      ? (getDb()
          .prepare(
            "SELECT * FROM review_freezes WHERE study_freeze_id=? AND status='verified' AND is_current=1 ORDER BY revision DESC LIMIT 1",
          )
          .get(input.studyFreezeId) as any)
      : null;
  const localizationRows = getDb()
    .prepare(
      `SELECT DISTINCT scan_time_localization_hash AS hash FROM scan_runs WHERE id IN (${runIds.map(() => "?").join(",")})`,
    )
    .all(...runIds) as Array<{ hash: string | null }>;
  const localizationHashes = localizationRows.map((row) => row.hash).filter(Boolean) as string[];
  if (new Set(localizationHashes).size > 1)
    throw new AppError(
      "LOCALIZATION_VERSION_MISMATCH",
      "同一 study export 不能混用扫描时中文目录版本",
      409,
    );
  const scanTimeLocalizationHash = localizationHashes[0] ?? null;
  const outcomeDigest =
    input.kind === "study_final"
      ? sha256(
          canonicalize({
            studyFreezeId: input.studyFreezeId,
            sourceManifestHash: sourceRecord?.manifest_hash ?? null,
            reviewFreezeHash: reviewFreeze?.artifact_hash ?? null,
            reportLocalizationHash: freeze.report_localization_hash ?? null,
            modelVersion: freeze.model_version,
            modelDecisionHash: freeze.model_decision_hash ?? null,
            modelObservationsHash: freeze.model_observations_hash ?? null,
            r4EvidenceBundleHash: freeze.r4_evidence_bundle_hash ?? null,
          }),
        )
      : null;
  const files = [] as Array<{ path: string; size: number; sha256: string }>;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(target, full).replaceAll(path.sep, "/");
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== "manifest.json" && entry.name !== "manifest.sha256") {
        const bytes = fs.readFileSync(full);
        files.push({ path: rel, size: bytes.length, sha256: sha256(bytes) });
      }
    }
  };
  walk(target);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    schemaVersion: "canonical-manifest-json-v1",
    exportId,
    generatedAt: new Date().toISOString(),
    exportKind: input.kind,
    kind: input.kind,
    studyFreezeId: input.studyFreezeId,
    sourceExportId: input.kind === "study_final" ? (input.expectedSourceExportId ?? null) : null,
    sourceManifestHash: input.kind === "study_final" ? (sourceRecord?.manifest_hash ?? null) : null,
    outcomeDigest,
    scanTimeLocalizationHash,
    modelDecisionHash: input.kind === "study_final" ? (freeze.model_decision_hash ?? null) : null,
    modelObservationsHash:
      input.kind === "study_final" ? (freeze.model_observations_hash ?? null) : null,
    reviewFreezeHash:
      input.kind === "study_final"
        ? ((
            getDb()
              .prepare(
                "SELECT artifact_hash FROM review_freezes WHERE study_freeze_id=? AND status='verified' AND is_current=1 ORDER BY revision DESC LIMIT 1",
              )
              .get(input.studyFreezeId) as any
          )?.artifact_hash ?? null)
        : null,
    reportLocalizationHash:
      input.kind === "study_final" ? (freeze.report_localization_hash ?? null) : null,
    r4EvidenceBundleHash:
      input.kind === "study_final" ? (freeze.r4_evidence_bundle_hash ?? null) : null,
    revision,
    runIds,
    files,
  };
  const manifestBytes = Buffer.from(canonicalize(manifest) + "\n");
  fs.writeFileSync(path.join(target, "manifest.json"), manifestBytes);
  fs.writeFileSync(path.join(target, "manifest.sha256"), `${sha256(manifestBytes)}\n`);
  const manifestHash = sha256(manifestBytes);
  const runSetHash = sha256(canonicalize(runIds));
  const record = {
    id: exportId,
    study_freeze_id: input.studyFreezeId,
    kind: input.kind,
    source_export_id: input.kind === "study_final" ? (input.expectedSourceExportId ?? null) : null,
    revision,
    outcome_digest: outcomeDigest,
    supersedes_export_id: previous?.id ?? null,
    is_current: 1,
    run_set_hash: runSetHash,
    status: "verified",
    storage_relpath: target,
    manifest_hash: manifestHash,
    source_manifest_hash:
      input.kind === "study_final" ? (sourceRecord?.manifest_hash ?? null) : null,
    review_freeze_hash: reviewFreeze?.artifact_hash ?? null,
    report_localization_hash:
      input.kind === "study_final" ? (freeze.report_localization_hash ?? null) : null,
    r4_evidence_bundle_hash:
      input.kind === "study_final" ? (freeze.r4_evidence_bundle_hash ?? null) : null,
    created_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
  };
  try {
    transaction((db) => {
      if (previous)
        db.prepare("UPDATE study_exports SET is_current=0,status='superseded' WHERE id=?").run(
          previous.id,
        );
      db.prepare(
        "INSERT INTO study_exports(id,study_freeze_id,kind,source_export_id,revision,outcome_digest,supersedes_export_id,is_current,run_set_hash,status,storage_relpath,manifest_hash,source_manifest_hash,review_freeze_hash,report_localization_hash,r4_evidence_bundle_hash,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        record.id,
        record.study_freeze_id,
        record.kind,
        record.source_export_id,
        record.revision,
        record.outcome_digest,
        record.supersedes_export_id,
        record.is_current,
        record.run_set_hash,
        record.status,
        record.storage_relpath,
        record.manifest_hash,
        record.source_manifest_hash,
        record.review_freeze_hash,
        record.report_localization_hash,
        record.r4_evidence_bundle_hash,
        record.created_at,
        record.verified_at,
      );
      runIds.forEach((runId, index) =>
        db
          .prepare("INSERT INTO study_export_runs(export_id,run_id,ordinal) VALUES (?,?,?)")
          .run(exportId, runId, index),
      );
    });
  } catch (error) {
    if (
      input.kind === "study_source" &&
      String(error).includes("idx_study_exports_current_unique")
    ) {
      const concurrent = getDb()
        .prepare(
          "SELECT * FROM study_exports WHERE study_freeze_id=? AND kind='study_source' AND is_current=1 AND status='verified'",
        )
        .get(input.studyFreezeId);
      if (concurrent) return concurrent;
    }
    throw error;
  }
  return record;
}
