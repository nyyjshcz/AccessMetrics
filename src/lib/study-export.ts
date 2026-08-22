import fs from "node:fs";
import path from "node:path";
import { getDb, transaction } from "./db";
import { config } from "./config";
import { canonicalize, sha256 } from "./canonical";
import { exportRun } from "./export";
import { AppError } from "./errors";

type ExportKind = "study_source" | "study_final";

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

function copyRunExports(target: string, runIds: string[]) {
  for (const runId of runIds) {
    const generated = exportRun(runId);
    const destination = path.join(target, "runs", runId);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ["scan.json", "issues.csv", "manifest.json", "manifest.sha256"])
      fs.copyFileSync(path.join(generated.target, file), path.join(destination, file));
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
  copyRunExports(target, canonicalRunIds);
  if (input.kind === "study_final") {
    const batch = db
      .prepare(
        "SELECT id FROM manual_review_batches WHERE study_freeze_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(input.studyFreezeId) as { id: string };
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
