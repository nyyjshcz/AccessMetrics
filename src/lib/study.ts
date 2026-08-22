import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "./canonical";
import { getDb, transaction } from "./db";
import { id } from "./ids";
import { AppError } from "./errors";
import { sampleManualReview } from "./sampler";
import { config } from "./config";
import { createScanJob } from "./repositories";

const EXECUTION_LOG_HEADER =
  "campaign_id,slot,replacement_rank,candidate_id,run_id,started_at,terminal_status,usability_decision,reason_code,replacement_activated_at";

function csvField(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function canonicalPopulation(runIds: string[]) {
  if (runIds.length === 0) return [] as Array<Record<string, unknown>>;
  const rows = getDb()
    .prepare(
      `SELECT rr.run_id AS runId,rr.page_id AS pageId,rr.rule_id AS ruleId,rr.result_type AS resultType,
              COALESCE(n.effective_impact,rr.impact) AS effectiveImpact,n.id AS resultNodeId,
              n.target_hash AS targetHash,n.target_json AS targetJson
         FROM result_nodes n
         JOIN rule_results rr ON rr.id=n.rule_result_id
        WHERE rr.run_id IN (${runIds.map(() => "?").join(",")})
          AND rr.result_type IN ('violation','incomplete')`,
    )
    .all(...runIds) as Array<{
    runId: string;
    pageId: string;
    ruleId: string;
    resultType: string;
    effectiveImpact: string | null;
    resultNodeId: string;
    targetHash: string | null;
    targetJson: string;
  }>;
  rows.sort(
    (a, b) =>
      a.runId.localeCompare(b.runId) ||
      a.pageId.localeCompare(b.pageId) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.resultType.localeCompare(b.resultType) ||
      a.resultNodeId.localeCompare(b.resultNodeId),
  );
  return rows.map((row) => ({
    result_node_id: row.resultNodeId,
    result_type: row.resultType,
    effective_impact: row.effectiveImpact,
    rule_id: row.ruleId,
    stable_node_hash:
      row.targetHash ?? sha256(canonicalize(parseJsonValue(row.targetJson) ?? row.targetJson)),
  }));
}

function executionLogBytes(campaignId: string, attempts: any[]) {
  const rows = attempts
    .slice()
    .sort((a, b) => a.slot - b.slot || a.attempt_no - b.attempt_no)
    .map((attempt) =>
      [
        campaignId,
        attempt.slot,
        attempt.replacement_rank,
        attempt.candidate_id,
        attempt.run_id,
        attempt.started_at,
        attempt.terminal_status,
        attempt.usability_decision,
        attempt.decision_reason_code,
        attempt.replacement_activated_at,
      ]
        .map(csvField)
        .join(","),
    );
  return Buffer.from(`${EXECUTION_LOG_HEADER}\n${rows.join("\n")}\n`);
}

function versionTripleForRuns(campaign: any, runIds: string[]) {
  if (runIds.length === 0) throw new AppError("NO_CANONICAL_RUNS", "没有 canonical run", 409);
  const rows = getDb()
    .prepare(
      `SELECT id,scanner_version scannerVersion,axe_version axeVersion,score_model_version modelVersion
         FROM scan_runs WHERE id IN (${runIds.map(() => "?").join(",")})`,
    )
    .all(...runIds) as Array<{
    id: string;
    scannerVersion: string;
    axeVersion: string;
    modelVersion: string;
  }>;
  if (rows.length !== runIds.length)
    throw new AppError("RUN_VERSION_MISSING", "canonical run 缺少版本记录", 409);
  const triples = new Set(
    rows.map((row) => `${row.scannerVersion}\u0000${row.axeVersion}\u0000${row.modelVersion}`),
  );
  if (triples.size !== 1)
    throw new AppError("VERSION_TRIPLE_MISMATCH", "canonical run 混用了多个版本三元组", 409);
  const row = rows[0];
  const triple = {
    scannerVersion: row.scannerVersion,
    axeVersion: row.axeVersion,
    modelVersion: row.modelVersion,
  };
  const baseline = parseJsonValue(campaign.baseline_triple_json) as any;
  if (
    baseline &&
    (baseline.scannerVersion !== triple.scannerVersion ||
      baseline.axeVersion !== triple.axeVersion ||
      baseline.modelVersion !== triple.modelVersion)
  )
    throw new AppError("VERSION_TRIPLE_MISMATCH", "canonical run 与 R1 锁定版本三元组不一致", 409);
  return triple;
}

export function createCampaign(plan: Record<string, unknown>) {
  const target = Number(plan.targetSiteCount ?? 0);
  if (!Number.isInteger(target) || target < 10 || target > 20)
    throw new AppError("INVALID_CAMPAIGN", "正式 campaign 必须是 10–20 个站点", 422);
  const allowed = new Set([
    "campaignPlanVersion",
    "campaignPlanHash",
    "protocolHash",
    "sampleFrameHash",
    "baseline",
    "targetSiteCount",
    "pageLimit",
    "retryPolicy",
    "replacementPolicy",
    "allowedFailureReasonCodes",
    "slots",
  ]);
  const unknown = Object.keys(plan).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new AppError("UNKNOWN_FIELD", `campaign plan 包含未定义字段: ${unknown.join(",")}`, 422);
  if (plan.campaignPlanVersion !== "campaign-plan-v1")
    throw new AppError("INVALID_CAMPAIGN", "campaignPlanVersion 必须为 campaign-plan-v1", 422);
  const withoutHash = { ...plan };
  delete withoutHash.campaignPlanHash;
  const hash = sha256(canonicalize(withoutHash));
  if (plan.campaignPlanHash !== undefined && plan.campaignPlanHash !== hash)
    throw new AppError("CAMPAIGN_HASH_MISMATCH", "campaignPlanHash 与服务端重算值不一致", 409);
  const campaignId = `sc_${hash.slice(0, 32)}`;
  const slots = Array.isArray(plan.slots) ? (plan.slots as Array<any>) : [];
  const pageLimit = Number(plan.pageLimit ?? 0);
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 15)
    throw new AppError("INVALID_CAMPAIGN", "pageLimit 必须是 1–15", 422);
  if (
    typeof plan.protocolHash !== "string" ||
    !plan.protocolHash ||
    typeof plan.sampleFrameHash !== "string" ||
    !plan.sampleFrameHash
  )
    throw new AppError("INVALID_CAMPAIGN", "protocolHash 和 sampleFrameHash 必须绑定冻结文件", 422);
  if (slots.length !== target)
    throw new AppError("INVALID_CAMPAIGN_SLOTS", "slots 数量必须等于 targetSiteCount", 422);
  const slotNumbers = slots.map((slot) => Number(slot.slot));
  if (
    new Set(slotNumbers).size !== target ||
    slotNumbers.some((slot) => !Number.isInteger(slot) || slot < 1 || slot > target)
  )
    throw new AppError("INVALID_CAMPAIGN_SLOTS", "slot 必须是 1..targetSiteCount 且不可重复", 422);
  for (const slot of slots) {
    if (typeof slot.primaryCandidateId !== "string" || !slot.primaryCandidateId)
      throw new AppError("INVALID_CAMPAIGN_SLOT", "每个 slot 必须有 primaryCandidateId", 422);
    if (
      !Array.isArray(slot.replacementCandidateIds) ||
      slot.replacementCandidateIds.some(
        (candidate: unknown) => typeof candidate !== "string" || !candidate,
      )
    )
      throw new AppError("INVALID_CAMPAIGN_SLOT", "replacementCandidateIds 必须是字符串数组", 422);
  }
  transaction((db) => {
    db.prepare(
      "INSERT OR IGNORE INTO study_campaigns(id,campaign_plan_hash,protocol_hash,sample_frame_hash,baseline_triple_json,target_site_count,page_limit,retry_policy_json,replacement_policy_json,allowed_failure_reason_codes_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      campaignId,
      hash,
      String(plan.protocolHash ?? ""),
      String(plan.sampleFrameHash ?? ""),
      JSON.stringify(plan.baseline ?? {}),
      target,
      pageLimit,
      JSON.stringify(plan.retryPolicy ?? {}),
      JSON.stringify(plan.replacementPolicy ?? {}),
      JSON.stringify(plan.allowedFailureReasonCodes ?? []),
      "planned",
      new Date().toISOString(),
    );
    for (const slot of slots) {
      const candidates = [slot.primaryCandidateId, ...(slot.replacementCandidateIds ?? [])];
      candidates.forEach((candidateId: string, replacementRank: number) => {
        const site = db.prepare("SELECT id FROM sites WHERE candidate_id=?").get(candidateId) as
          | { id: string }
          | undefined;
        db.prepare(
          "INSERT OR IGNORE INTO study_campaign_sites(campaign_id,slot,candidate_id,site_id,replacement_rank,category,planned_reason) VALUES (?,?,?,?,?,?,?)",
        ).run(
          campaignId,
          Number(slot.slot),
          candidateId,
          site?.id ?? null,
          replacementRank,
          String(slot.category ?? "unknown"),
          "R1预排候选",
        );
      });
    }
  });
  return { campaignId, campaignPlanHash: hash };
}

export function appendAttempt(attempt: {
  campaignId: string;
  slot: number;
  candidateId: string;
  replacementRank: number;
  attemptNo: number;
  runId?: string;
  trigger: string;
  terminalStatus: string;
  usabilityDecision: string;
  decisionReasonCode?: string;
  replacementActivatedAt?: string | null;
}) {
  const attemptId = id("attempt");
  const startedAt = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO study_run_attempts(id,campaign_id,slot,candidate_id,replacement_rank,attempt_no,run_id,trigger,terminal_status,usability_decision,decision_reason_code,started_at,completed_at,replacement_activated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      attemptId,
      attempt.campaignId,
      attempt.slot,
      attempt.candidateId,
      attempt.replacementRank,
      attempt.attemptNo,
      attempt.runId ?? null,
      attempt.trigger,
      attempt.terminalStatus,
      attempt.usabilityDecision,
      attempt.decisionReasonCode ?? null,
      startedAt,
      startedAt,
      attempt.replacementActivatedAt ?? (attempt.replacementRank > 0 ? startedAt : null),
    );
  return attemptId;
}

export function startCampaignRun(campaignId: string, requestedBy: string) {
  const campaign = getDb()
    .prepare("SELECT * FROM study_campaigns WHERE id=?")
    .get(campaignId) as any;
  if (!campaign) throw new AppError("NOT_FOUND", "campaign 不存在", 404);
  if (campaign.status !== "r1_approved")
    throw new AppError("R1_REQUIRED", "campaign 必须先通过 R1", 409);
  const slot = getDb()
    .prepare(
      `SELECT cs.*,s.id site_id,s.origin,s.name
       FROM study_campaign_sites cs
       LEFT JOIN sites s ON s.id=cs.site_id
       LEFT JOIN study_run_attempts a ON a.campaign_id=cs.campaign_id AND a.slot=cs.slot AND a.replacement_rank=cs.replacement_rank
       WHERE cs.campaign_id=? AND a.id IS NULL
       ORDER BY cs.slot,cs.replacement_rank LIMIT 1`,
    )
    .get(campaignId) as any;
  if (!slot) return { campaignId, status: "complete", jobId: null };
  if (!slot.origin)
    throw new AppError(
      "SAMPLE_SITE_NOT_IMPORTED",
      `候选 ${slot.candidate_id} 尚未导入正式 sample-frame`,
      409,
    );
  const attemptNo =
    (
      getDb()
        .prepare("SELECT COUNT(*) count FROM study_run_attempts WHERE campaign_id=? AND slot=?")
        .get(campaignId, slot.slot) as { count: number }
    ).count + 1;
  const job = createScanJob(
    slot.origin,
    { maxPages: campaign.page_limit, sameOriginOnly: true, respectRobots: true },
    requestedBy,
    `study:${campaignId}:${slot.slot}:${slot.replacement_rank}`,
    slot.origin,
    {
      campaignId,
      slot: slot.slot,
      candidateId: slot.candidate_id,
      replacementRank: slot.replacement_rank,
      attemptNo,
    },
  );
  return {
    campaignId,
    status: job.reused ? "queued_reused" : "queued",
    jobId: job.id,
    nextSlot: {
      slot: slot.slot,
      candidateId: slot.candidate_id,
      replacementRank: slot.replacement_rank,
    },
  };
}

export function freezeCampaign(campaignId: string) {
  const campaign = getDb()
    .prepare("SELECT * FROM study_campaigns WHERE id=?")
    .get(campaignId) as any;
  if (!campaign) throw new AppError("NOT_FOUND", "campaign 不存在", 404);
  if (campaign.status !== "r1_approved")
    throw new AppError("R1_REQUIRED", "campaign 必须先通过两位负责人 R1", 409);
  const plannedSlots = getDb()
    .prepare("SELECT DISTINCT slot FROM study_campaign_sites WHERE campaign_id=? ORDER BY slot")
    .all(campaignId) as Array<{ slot: number }>;
  const attempts = getDb()
    .prepare("SELECT * FROM study_run_attempts WHERE campaign_id=? ORDER BY slot,attempt_no")
    .all(campaignId) as any[];
  const candidateCounts = getDb()
    .prepare(
      "SELECT slot,COUNT(*) count FROM study_campaign_sites WHERE campaign_id=? GROUP BY slot",
    )
    .all(campaignId) as Array<{ slot: number; count: number }>;
  const allowedFailureReasonCodes = new Set(
    (parseJsonValue(campaign.allowed_failure_reason_codes_json) as unknown[] | null) ?? [],
  );
  const unapprovedFailures = attempts.filter(
    (attempt) =>
      attempt.usability_decision !== "included" &&
      (!attempt.decision_reason_code ||
        !allowedFailureReasonCodes.has(attempt.decision_reason_code)),
  );
  if (unapprovedFailures.length)
    throw new AppError("UNAPPROVED_FAILURE_REASON", "attempt 使用了 R1 未预注册的失败原因", 409);
  if (
    plannedSlots.length !== campaign.target_site_count ||
    attempts.length === 0 ||
    plannedSlots.some((slot) => !attempts.some((attempt) => attempt.slot === slot.slot)) ||
    attempts.some(
      (attempt) => !["completed", "failed", "cancelled"].includes(attempt.terminal_status),
    ) ||
    candidateCounts.some((slot) => {
      const slotAttempts = attempts.filter((attempt) => attempt.slot === slot.slot);
      return (
        !slotAttempts.some((attempt) => attempt.usability_decision === "included") &&
        slotAttempts.length < slot.count
      );
    })
  )
    throw new AppError("CAMPAIGN_NOT_READY", "没有正式 attempt，不能 freeze", 409);
  const canonicalRuns = [];
  for (const slot of [...new Set(attempts.map((a) => a.slot))].sort((a, b) => a - b)) {
    const included = attempts.find((a) => a.slot === slot && a.usability_decision === "included");
    canonicalRuns.push({
      slot,
      runId: included?.run_id ?? null,
      status: included ? "included" : "failed",
    });
  }
  const attemptLog = attempts.map((attempt) => ({
    campaignId,
    slot: attempt.slot,
    candidateId: attempt.candidate_id,
    replacementRank: attempt.replacement_rank,
    attemptNo: attempt.attempt_no,
    runId: attempt.run_id,
    trigger: attempt.trigger,
    terminalStatus: attempt.terminal_status,
    usabilityDecision: attempt.usability_decision,
    reasonCode: attempt.decision_reason_code,
    replacementActivatedAt: attempt.replacement_activated_at,
  }));
  const attemptLogHash = sha256(canonicalize(attemptLog));
  const runSetHash = sha256(canonicalize(canonicalRuns));
  const runIds = canonicalRuns.filter((run) => run.runId).map((run) => run.runId);
  const population = canonicalPopulation(runIds);
  const populationDigest = sha256(canonicalize(population));
  const executionLog = executionLogBytes(campaignId, attempts);
  const executionLogHash = sha256(executionLog);
  const executionLogPath = path.join(
    config.privateEvidenceRoot,
    "study-campaigns",
    campaignId,
    "inclusion-exclusion-log.csv",
  );
  fs.mkdirSync(path.dirname(executionLogPath), { recursive: true });
  if (fs.existsSync(executionLogPath)) {
    const existingHash = sha256(fs.readFileSync(executionLogPath));
    if (existingHash !== executionLogHash)
      throw new AppError("EXECUTION_LOG_IMMUTABLE", "正式 execution log 已存在且字节不一致", 409);
  } else {
    fs.writeFileSync(executionLogPath, executionLog, { flag: "wx" });
    fs.chmodSync(executionLogPath, 0o444);
  }
  const versionTriple = versionTripleForRuns(campaign, runIds);
  const freezeDigest = sha256(
    canonicalize({
      campaignPlanHash: campaign.campaign_plan_hash,
      protocolHash: campaign.protocol_hash,
      sampleFrameHash: campaign.sample_frame_hash,
      attemptLogHash,
      executionLogHash,
      versionTriple,
      canonicalRunSet: canonicalRuns,
      populationDigest,
    }),
  );
  const freezeId = `sf_${freezeDigest.slice(0, 32)}`;
  const existing = getDb()
    .prepare("SELECT * FROM study_freezes WHERE campaign_id=?")
    .get(campaignId) as any;
  if (existing) {
    if (
      existing.freeze_digest !== freezeDigest ||
      existing.attempt_log_hash !== attemptLogHash ||
      existing.execution_log_hash !== executionLogHash ||
      existing.population_digest !== populationDigest ||
      existing.run_set_hash !== runSetHash
    )
      throw new AppError("FREEZE_IMMUTABLE", "同一 campaign 的 study freeze 输入已发生变化", 409);
    return {
      freezeId: existing.id,
      freezeDigest: existing.freeze_digest,
      attemptLogHash: existing.attempt_log_hash,
      executionLogHash: existing.execution_log_hash,
      runSetHash: existing.run_set_hash,
      populationDigest: existing.population_digest,
      canonicalRuns,
      reused: true,
    };
  }
  getDb()
    .prepare(
      "INSERT INTO study_freezes(id,campaign_id,attempt_log_hash,freeze_digest,protocol_hash,sample_frame_hash,execution_log_hash,scanner_version,axe_version,model_version,run_set_hash,population_digest,eligible_population_count,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      freezeId,
      campaignId,
      attemptLogHash,
      freezeDigest,
      campaign.protocol_hash,
      campaign.sample_frame_hash,
      executionLogHash,
      versionTriple.scannerVersion,
      versionTriple.axeVersion,
      versionTriple.modelVersion,
      runSetHash,
      populationDigest,
      population.length,
      "registered",
      new Date().toISOString(),
    );
  return {
    freezeId,
    freezeDigest,
    attemptLogHash,
    executionLogHash,
    runSetHash,
    populationDigest,
    canonicalRuns,
    reused: false,
  };
}

export function createManualReviewBatch(
  freezeId: string,
  sourceExportId: string,
  expectedSourceManifestHash?: string,
) {
  const source = getDb()
    .prepare("SELECT * FROM study_exports WHERE id=? AND kind='study_source' AND status='verified'")
    .get(sourceExportId) as any;
  if (!source)
    throw new AppError("SOURCE_NOT_ELIGIBLE", "只有 verified study_source 可以抽样", 409);
  const freeze = getDb().prepare("SELECT * FROM study_freezes WHERE id=?").get(freezeId) as any;
  if (!freeze || source.study_freeze_id !== freezeId)
    throw new AppError("FREEZE_MISMATCH", "source 与 freeze 不匹配", 409);
  if (freeze.status !== "source_verified")
    throw new AppError("SOURCE_FREEZE_STATE", "source_verified freeze 才能创建正式抽样", 409);
  if (!source.storage_relpath || !fs.existsSync(source.storage_relpath))
    throw new AppError("SOURCE_MISSING", "study_source 目录不存在", 409);
  const sourceManifestPath = path.join(source.storage_relpath, "manifest.json");
  const sourceManifestHash = source.manifest_hash;
  if (
    expectedSourceManifestHash !== undefined &&
    (typeof expectedSourceManifestHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(expectedSourceManifestHash) ||
      expectedSourceManifestHash !== sourceManifestHash)
  )
    throw new AppError(
      "SOURCE_MANIFEST_MISMATCH",
      "请求的 sourceManifestHash 与 source 不一致",
      409,
    );
  if (!sourceManifestHash || !fs.existsSync(sourceManifestPath))
    throw new AppError("SOURCE_MANIFEST_MISSING", "study_source manifest 缺失", 409);
  if (sha256(fs.readFileSync(sourceManifestPath)) !== sourceManifestHash)
    throw new AppError("SOURCE_MANIFEST_MISMATCH", "study_source manifest hash 不匹配", 409);
  const sourceManifestDigestPath = path.join(source.storage_relpath, "manifest.sha256");
  if (
    !fs.existsSync(sourceManifestDigestPath) ||
    fs.readFileSync(sourceManifestDigestPath, "utf8").trim() !== sourceManifestHash
  )
    throw new AppError("SOURCE_MANIFEST_MISMATCH", "study_source manifest.sha256 不匹配", 409);
  const sourceFiles: string[] = [];
  const collectSourceFiles = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) collectSourceFiles(full);
      else sourceFiles.push(full);
    }
  };
  collectSourceFiles(source.storage_relpath);
  if (
    (fs.statSync(source.storage_relpath).mode & 0o222) !== 0 ||
    sourceFiles.some((file) => (fs.statSync(file).mode & 0o222) !== 0)
  )
    throw new AppError("SOURCE_NOT_READONLY", "study_source 目录必须只读", 409);
  const sourceRuns = getDb()
    .prepare("SELECT run_id FROM study_export_runs WHERE export_id=? ORDER BY ordinal")
    .all(sourceExportId) as Array<{ run_id: string }>;
  const freezeRuns = getDb()
    .prepare(
      "SELECT run_id FROM study_export_runs WHERE export_id IN (SELECT id FROM study_exports WHERE study_freeze_id=? AND kind='study_source' AND status='verified') ORDER BY ordinal",
    )
    .all(freezeId) as Array<{ run_id: string }>;
  if (
    !sourceRuns.length ||
    sourceRuns.map((row) => row.run_id).join("\u0000") !==
      freezeRuns.map((row) => row.run_id).join("\u0000")
  )
    throw new AppError("SOURCE_RUN_SET_MISMATCH", "source run set 与 freeze 不一致", 409);
  const sourcePopulation = canonicalPopulation(sourceRuns.map((row) => row.run_id));
  if (sha256(canonicalize(sourcePopulation)) !== freeze.population_digest)
    throw new AppError(
      "SOURCE_POPULATION_MISMATCH",
      "source populationDigest 与 freeze 不一致",
      409,
    );
  const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8")) as any;
  if (
    sourceManifest.exportKind !== "study_source" ||
    sourceManifest.studyFreezeId !== freezeId ||
    JSON.stringify(sourceManifest.runIds ?? []) !==
      JSON.stringify(sourceRuns.map((row) => row.run_id))
  )
    throw new AppError("SOURCE_MANIFEST_MISMATCH", "source manifest 的研究绑定不一致", 409);
  if (
    sourceManifest.modelDecisionHash ||
    sourceManifest.modelObservationsHash ||
    fs.existsSync(path.join(source.storage_relpath, "manual-reviews.json")) ||
    fs.existsSync(path.join(source.storage_relpath, "review-freeze.json"))
  )
    throw new AppError(
      "SOURCE_REVIEW_CONTAMINATED",
      "study_source 不得包含 final 或审核 payload",
      409,
    );
  const sourceVersion = versionTripleForRuns(
    {
      baseline_triple_json: JSON.stringify({
        scannerVersion: freeze.scanner_version,
        axeVersion: freeze.axe_version,
        modelVersion: freeze.model_version,
      }),
    },
    sourceRuns.map((row) => row.run_id),
  );
  if (
    sourceVersion.scannerVersion !== freeze.scanner_version ||
    sourceVersion.axeVersion !== freeze.axe_version ||
    sourceVersion.modelVersion !== freeze.model_version
  )
    throw new AppError("SOURCE_VERSION_MISMATCH", "study_source 混用了版本三元组", 409);
  const existing = getDb()
    .prepare(
      "SELECT * FROM manual_review_batches WHERE study_freeze_id=? AND source_export_id=? AND algorithm_version='manual-review-sampler-v1' ORDER BY created_at LIMIT 1",
    )
    .get(freezeId, sourceExportId) as any;
  if (existing)
    return {
      batchId: existing.id,
      populationSize: existing.population_size,
      targetSize: existing.target_size,
      seed: existing.seed,
      quota: JSON.parse(existing.strata_config_json),
      status: existing.status,
      reused: true,
    };
  const population = canonicalPopulation(sourceRuns.map((row) => row.run_id)).map((row) => ({
    result_node_id: row.result_node_id,
    result_type: row.result_type,
    effective_impact: row.effective_impact,
    rule_id: row.rule_id,
  }));
  const sampled = sampleManualReview(
    population.map((item) => ({
      resultNodeId: String(item.result_node_id),
      resultType: String(item.result_type) as "violation" | "incomplete",
      impact: item.effective_impact as string | null | undefined,
      ruleId: String(item.rule_id),
    })),
    freeze.population_digest,
  );
  const batchId = id("batch");
  const status = sampled.targetSize === 0 ? "completed_no_eligible_items" : "generated";
  transaction((db) => {
    db.prepare(
      "INSERT INTO manual_review_batches(id,study_freeze_id,source_export_id,source_manifest_hash,population_digest,algorithm_version,seed,target_size,population_size,strata_config_json,status,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      batchId,
      freezeId,
      sourceExportId,
      source.manifest_hash,
      freeze.population_digest,
      "manual-review-sampler-v1",
      sampled.seed,
      sampled.targetSize,
      population.length,
      JSON.stringify(sampled.quota),
      status,
      new Date().toISOString(),
      sampled.targetSize === 0 ? new Date().toISOString() : null,
    );
    sampled.selected.forEach((item, index) =>
      db
        .prepare(
          "INSERT INTO manual_review_samples(id,batch_id,result_node_id,result_type,effective_impact,rule_id,stratum,draw_order,selected_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id("sample"),
          batchId,
          item.resultNodeId,
          item.resultType,
          item.impact,
          item.ruleId,
          item.stratum,
          index + 1,
          new Date().toISOString(),
        ),
    );
  });
  return {
    batchId,
    populationSize: population.length,
    targetSize: sampled.targetSize,
    seed: sampled.seed,
    quota: sampled.quota,
    status,
  };
}

export function freezeManualReviews(freezeId: string, batchId: string) {
  const batch = getDb()
    .prepare("SELECT * FROM manual_review_batches WHERE id=? AND study_freeze_id=?")
    .get(batchId, freezeId) as any;
  if (!batch) throw new AppError("NOT_FOUND", "review batch 不存在或与 freeze 不匹配", 404);
  const freeze = getDb().prepare("SELECT * FROM study_freezes WHERE id=?").get(freezeId) as any;
  if (
    !freeze ||
    !["source_verified", "reviews_completed", "r4_verified", "final_verified"].includes(
      freeze.status,
    )
  )
    throw new AppError("FREEZE_STATE", "study freeze 状态不允许冻结 R2/R3", 409);
  const samples = getDb()
    .prepare("SELECT * FROM manual_review_samples WHERE batch_id=? ORDER BY draw_order")
    .all(batchId) as any[];
  const reviewRows: any[] = [];
  const adjudicationRows: any[] = [];
  for (const sample of samples) {
    const reviews = getDb()
      .prepare(
        "SELECT * FROM manual_reviews WHERE sample_id=? AND review_context='formal' AND is_current=1 ORDER BY reviewer",
      )
      .all(sample.id) as any[];
    const computer = reviews.find((review) => review.reviewer === "computer_lead");
    const math = reviews.find((review) => review.reviewer === "math_lead");
    if (!computer || !math)
      throw new AppError("REVIEWS_INCOMPLETE", `样本 ${sample.id} 尚未完成双人复核`, 409);
    reviewRows.push({
      sampleId: sample.id,
      reviews: reviews.map((review) => ({
        id: review.id,
        reviewer: review.reviewer,
        verdict: review.verdict,
        note: review.note,
        revision: review.revision,
      })),
    });
    if (computer.verdict !== math.verdict) {
      const adjudication = getDb()
        .prepare(
          "SELECT * FROM manual_review_adjudications WHERE sample_id=? AND status='approved' AND is_current=1 ORDER BY revision DESC LIMIT 1",
        )
        .get(sample.id) as any;
      if (!adjudication)
        throw new AppError("ADJUDICATION_INCOMPLETE", `样本 ${sample.id} 的分歧尚未完成裁决`, 409);
      adjudicationRows.push({
        sampleId: sample.id,
        id: adjudication.id,
        verdict: adjudication.adjudicated_verdict,
        resolutionHash: adjudication.resolution_hash,
        revision: adjudication.revision,
      });
    }
  }
  const reviewSetHash = sha256(canonicalize({ batchId, reviews: reviewRows }));
  const adjudicationSetHash = sha256(canonicalize({ batchId, adjudications: adjudicationRows }));
  const artifact = {
    schemaVersion: "review-freeze-v1",
    freezeId,
    batchId,
    sourceExportId: batch.source_export_id,
    sourceManifestHash: batch.source_manifest_hash,
    reviewSetHash,
    adjudicationSetHash,
    reviews: reviewRows,
    adjudications: adjudicationRows,
  };
  const artifactBytes = canonicalize(artifact) + "\n";
  const artifactHash = sha256(artifactBytes);
  const existing = getDb()
    .prepare(
      "SELECT * FROM review_freezes WHERE study_freeze_id=? AND batch_id=? AND artifact_hash=? AND is_current=1",
    )
    .get(freezeId, batchId, artifactHash) as any;
  if (existing)
    return {
      reviewFreezeId: existing.id,
      reviewSetHash,
      adjudicationSetHash,
      artifactHash,
      reused: true,
    };
  const previous = getDb()
    .prepare("SELECT * FROM review_freezes WHERE study_freeze_id=? ORDER BY revision DESC LIMIT 1")
    .get(freezeId) as any;
  const reviewFreezeId = id("review-freeze");
  const storageRelpath = path.join(
    config.privateEvidenceRoot,
    "review-freezes",
    reviewFreezeId,
    "review-freeze.json",
  );
  fs.mkdirSync(path.dirname(storageRelpath), { recursive: true });
  const temporary = `${storageRelpath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, artifactBytes);
  fs.renameSync(temporary, storageRelpath);
  fs.chmodSync(storageRelpath, 0o444);
  fs.chmodSync(path.dirname(storageRelpath), 0o555);
  transaction((db) => {
    if (previous)
      db.prepare("UPDATE review_freezes SET is_current=0,status='superseded' WHERE id=?").run(
        previous.id,
      );
    db.prepare(
      "INSERT INTO review_freezes(id,study_freeze_id,batch_id,revision,review_set_hash,adjudication_set_hash,artifact_hash,storage_relpath,status,supersedes_review_freeze_id,is_current,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      reviewFreezeId,
      freezeId,
      batchId,
      previous ? previous.revision + 1 : 1,
      reviewSetHash,
      adjudicationSetHash,
      artifactHash,
      storageRelpath,
      "awaiting_r3",
      previous?.id ?? null,
      1,
      new Date().toISOString(),
      null,
    );
    db.prepare("UPDATE manual_review_batches SET status=?,completed_at=? WHERE id=?").run(
      samples.length === 0 ? "completed_no_eligible_items" : "completed",
      new Date().toISOString(),
      batchId,
    );
    if (previous || freeze.status !== "source_verified") {
      db.prepare(
        "UPDATE study_exports SET status='invalidated',is_current=0,publication_status='withdrawn',publication_revision=publication_revision+1,withdrawn_at=?,publication_error=? WHERE study_freeze_id=? AND kind='study_final' AND is_current=1",
      ).run(
        new Date().toISOString(),
        "review-freeze revision superseded upstream outcome",
        freezeId,
      );
    }
    db.prepare(
      "UPDATE study_freezes SET status='source_verified',review_freeze_id=?,review_freeze_hash=?,report_localization_hash=NULL,model_decision_hash=NULL,model_observations_hash=NULL,r4_evidence_bundle_hash=NULL,final_verified_at=NULL WHERE id=?",
    ).run(reviewFreezeId, artifactHash, freezeId);
  });
  return { reviewFreezeId, reviewSetHash, adjudicationSetHash, artifactHash, reused: false };
}

export function verifyReviewFreezeAfterR3(freezeId: string) {
  const freeze = getDb().prepare("SELECT * FROM study_freezes WHERE id=?").get(freezeId) as any;
  if (!freeze) throw new AppError("NOT_FOUND", "study freeze 不存在", 404);
  const reviewFreeze = getDb()
    .prepare(
      "SELECT * FROM review_freezes WHERE study_freeze_id=? AND status='awaiting_r3' AND is_current=1 ORDER BY revision DESC LIMIT 1",
    )
    .get(freezeId) as any;
  if (!reviewFreeze) {
    const verified = getDb()
      .prepare(
        "SELECT * FROM review_freezes WHERE study_freeze_id=? AND status='verified' AND is_current=1 ORDER BY revision DESC LIMIT 1",
      )
      .get(freezeId) as any;
    if (verified) return { reviewFreezeId: verified.id, status: "verified", reused: true };
    throw new AppError("REVIEW_FREEZE_REQUIRED", "没有 awaiting_r3 review-freeze", 409);
  }
  const approved = getDb()
    .prepare(
      "SELECT DISTINCT role FROM human_gate_evidence WHERE gate_id='R3' AND campaign_id=? AND decision='approved' AND is_current=1",
    )
    .all(freeze.campaign_id) as Array<{ role: string }>;
  if (approved.length !== 2 || new Set(approved.map((row) => row.role)).size !== 2)
    throw new AppError("R3_REQUIRED", "两位负责人尚未通过 R3", 409);
  transaction((db) => {
    db.prepare(
      "UPDATE review_freezes SET status='verified',verified_at=? WHERE id=? AND status='awaiting_r3'",
    ).run(new Date().toISOString(), reviewFreeze.id);
    db.prepare(
      "UPDATE study_freezes SET status='reviews_completed' WHERE id=? AND status='source_verified'",
    ).run(freezeId);
  });
  return { reviewFreezeId: reviewFreeze.id, status: "verified", reused: false };
}

export function invalidateStudyReviewChain(
  db: ReturnType<typeof getDb>,
  batchId: string,
  reason = "formal review or adjudication revision superseded R3/R4/final",
) {
  const batch = db
    .prepare("SELECT study_freeze_id FROM manual_review_batches WHERE id=?")
    .get(batchId) as { study_freeze_id: string } | undefined;
  if (!batch) return false;
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE review_freezes SET is_current=0,status='superseded' WHERE study_freeze_id=? AND is_current=1",
  ).run(batch.study_freeze_id);
  db.prepare(
    "UPDATE study_exports SET status='invalidated',is_current=0,publication_status='withdrawn',publication_revision=publication_revision+1,withdrawn_at=?,publication_error=? WHERE study_freeze_id=? AND kind='study_final' AND is_current=1",
  ).run(now, reason, batch.study_freeze_id);
  db.prepare(
    "UPDATE study_freezes SET status='source_verified',review_freeze_id=NULL,review_freeze_hash=NULL,report_localization_hash=NULL,model_decision_hash=NULL,model_observations_hash=NULL,r4_evidence_bundle_hash=NULL,final_verified_at=NULL WHERE id=? AND status IN ('reviews_completed','r4_verified','final_verified','source_verified')",
  ).run(batch.study_freeze_id);
  return true;
}

export function finalizeStudyFreeze(input: {
  freezeId: string;
  reportLocalizationHash: string;
  modelDecisionHash: string;
  modelObservationsHash: string;
}) {
  const freeze = getDb()
    .prepare("SELECT * FROM study_freezes WHERE id=?")
    .get(input.freezeId) as any;
  if (!freeze) throw new AppError("NOT_FOUND", "study freeze 不存在", 404);
  if (!["reviews_completed", "r4_verified", "final_verified"].includes(freeze.status))
    throw new AppError("FREEZE_STATE", "study freeze 必须先完成 R3 才能进入 R4", 409);
  for (const [name, value] of [
    ["reportLocalizationHash", input.reportLocalizationHash],
    ["modelDecisionHash", input.modelDecisionHash],
    ["modelObservationsHash", input.modelObservationsHash],
  ] as const)
    if (!/^[a-f0-9]{64}$/.test(value))
      throw new AppError("INVALID_HASH", `${name} 必须是 SHA-256`, 422);
  const reviewFreeze = getDb()
    .prepare(
      "SELECT * FROM review_freezes WHERE study_freeze_id=? AND status='verified' AND is_current=1",
    )
    .get(input.freezeId) as any;
  if (!reviewFreeze)
    throw new AppError("REVIEW_FREEZE_REQUIRED", "R2/R3 review freeze 尚未完成", 409);
  const r4 = getDb()
    .prepare(
      "SELECT role,receipt_hash,artifact_bundle_hash FROM human_gate_evidence WHERE gate_id='R4' AND campaign_id=? AND decision='approved' AND is_current=1 ORDER BY role",
    )
    .all(freeze.campaign_id) as Array<{
    role: string;
    receipt_hash: string;
    artifact_bundle_hash: string | null;
  }>;
  if (
    r4.length !== 2 ||
    new Set(r4.map((row) => row.role)).size !== 2 ||
    !new Set(r4.map((row) => row.role)).has("computer_lead") ||
    !new Set(r4.map((row) => row.role)).has("math_lead") ||
    r4.some((row) => !row.artifact_bundle_hash)
  )
    throw new AppError("R4_REQUIRED", "两位负责人尚未通过 schema-valid R4", 409);
  const bundleHash = sha256(
    canonicalize(
      r4
        .map((row) => ({
          role: row.role,
          receiptHash: row.receipt_hash,
          artifactBundleHash: row.artifact_bundle_hash,
        }))
        .sort((a, b) => a.role.localeCompare(b.role)),
    ),
  );
  const unchanged =
    ["r4_verified", "final_verified"].includes(freeze.status) &&
    freeze.review_freeze_id === reviewFreeze.id &&
    freeze.review_freeze_hash === reviewFreeze.artifact_hash &&
    freeze.report_localization_hash === input.reportLocalizationHash &&
    freeze.model_decision_hash === input.modelDecisionHash &&
    freeze.model_observations_hash === input.modelObservationsHash &&
    freeze.r4_evidence_bundle_hash === bundleHash;
  if (unchanged)
    return {
      freezeId: input.freezeId,
      status: freeze.status,
      reviewFreezeHash: reviewFreeze.artifact_hash,
      r4EvidenceBundleHash: bundleHash,
      reused: true,
    };
  transaction((db) => {
    db.prepare(
      "UPDATE study_exports SET status='invalidated',is_current=0,publication_status='withdrawn',publication_revision=publication_revision+1,withdrawn_at=?,publication_error=? WHERE study_freeze_id=? AND kind='study_final' AND is_current=1",
    ).run(new Date().toISOString(), "R4 inputs changed upstream outcome", input.freezeId);
    db.prepare(
      "UPDATE study_freezes SET status='r4_verified',review_freeze_id=?,review_freeze_hash=?,report_localization_hash=?,model_decision_hash=?,model_observations_hash=?,r4_evidence_bundle_hash=?,final_verified_at=NULL WHERE id=? AND status IN ('reviews_completed','r4_verified','final_verified')",
    ).run(
      reviewFreeze.id,
      reviewFreeze.artifact_hash,
      input.reportLocalizationHash,
      input.modelDecisionHash,
      input.modelObservationsHash,
      bundleHash,
      new Date().toISOString(),
      input.freezeId,
    );
  });
  return {
    freezeId: input.freezeId,
    status: "r4_verified",
    reviewFreezeHash: reviewFreeze.artifact_hash,
    r4EvidenceBundleHash: bundleHash,
    reused: false,
  };
}

export function submitGateEvidence(input: {
  gateId: string;
  campaignId?: string;
  role: string;
  decision: "approved" | "rejected";
  statementVersion: string;
  boundCommit?: string;
  artifacts: unknown[];
  note: string;
}) {
  if (!["R1", "R2", "R3", "R4", "R5"].includes(input.gateId))
    throw new AppError("INVALID_GATE", "gate 必须是 R1–R5", 422);
  if (
    input.campaignId &&
    !getDb().prepare("SELECT 1 FROM study_campaigns WHERE id=?").get(input.campaignId)
  )
    throw new AppError("CAMPAIGN_NOT_FOUND", "campaign 不存在", 404);
  const campaignId = input.campaignId ?? null;
  const boundCommit = input.boundCommit ?? null;
  const artifactsJson = canonicalize(input.artifacts);
  const existingByHash = getDb()
    .prepare(
      "SELECT id,receipt_hash FROM human_gate_evidence WHERE gate_id=? AND role=? AND campaign_id IS ? AND decision=? AND statement_version=? AND bound_commit IS ? AND artifacts_json=? AND note=? AND is_current=1 ORDER BY revision DESC LIMIT 1",
    )
    .get(
      input.gateId,
      input.role,
      campaignId,
      input.decision,
      input.statementVersion,
      boundCommit,
      artifactsJson,
      input.note,
    ) as { id: string; receipt_hash: string } | undefined;
  if (existingByHash)
    return {
      evidenceId: existingByHash.id,
      receiptHash: existingByHash.receipt_hash,
      reused: true,
    };
  const evidenceId = id("evidence");
  const receipt = {
    schemaVersion: "human-gate-receipt-v1",
    evidenceId,
    gateId: input.gateId,
    campaignId,
    role: input.role,
    decision: input.decision,
    statementVersion: input.statementVersion,
    boundCommit,
    artifacts: input.artifacts,
    note: input.note,
    revision: 1,
    reviewedAt: new Date().toISOString(),
  };
  const previous = getDb()
    .prepare(
      "SELECT id,revision FROM human_gate_evidence WHERE gate_id=? AND role=? AND campaign_id IS ? AND is_current=1 ORDER BY revision DESC LIMIT 1",
    )
    .get(input.gateId, input.role, campaignId) as { id: string; revision: number } | undefined;
  const revision = previous ? previous.revision + 1 : 1;
  receipt.revision = revision;
  const receiptHash = sha256(canonicalize(receipt));
  const finalReceipt = { ...receipt, receiptHash };
  const targetRelpath = `gates/${input.gateId}/${input.role}/${receiptHash}.json`;
  const artifactBundleHash = sha256(canonicalize(input.artifacts));
  const finalReceiptBytes = canonicalize(finalReceipt);
  transaction((db) => {
    db.prepare(
      "UPDATE human_gate_evidence SET is_current=0 WHERE gate_id=? AND role=? AND campaign_id IS ? AND is_current=1",
    ).run(input.gateId, input.role, campaignId);
    db.prepare(
      "INSERT INTO human_gate_evidence(id,gate_id,campaign_id,role,decision,statement_version,bound_commit,artifacts_json,note,revision,supersedes_evidence_id,is_current,reviewed_at,receipt_hash,artifact_bundle_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      evidenceId,
      input.gateId,
      campaignId,
      input.role,
      input.decision,
      input.statementVersion,
      boundCommit,
      canonicalize(input.artifacts),
      input.note,
      revision,
      previous?.id ?? null,
      1,
      finalReceipt.reviewedAt,
      receiptHash,
      artifactBundleHash,
    );
    db.prepare(
      "INSERT INTO human_gate_evidence_outbox(id,evidence_id,target_relpath,receipt_json,expected_file_hash,status,created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      id("outbox"),
      evidenceId,
      targetRelpath,
      finalReceiptBytes,
      sha256(finalReceiptBytes),
      "pending",
      finalReceipt.reviewedAt,
    );
    if (input.gateId === "R1" && input.campaignId && input.decision === "approved") {
      const approved = db
        .prepare(
          "SELECT COUNT(DISTINCT role) AS count FROM human_gate_evidence WHERE gate_id='R1' AND campaign_id=? AND decision='approved' AND is_current=1",
        )
        .get(input.campaignId) as { count: number };
      if (approved.count >= 2)
        db.prepare(
          "UPDATE study_campaigns SET status='r1_approved' WHERE id=? AND status='planned'",
        ).run(input.campaignId);
    }
  });
  return { evidenceId, receiptHash, targetRelpath };
}

export function deriveGateArtifacts(gateId: string) {
  const root = path.join(config.privateEvidenceRoot, "gates", gateId);
  if (!fs.existsSync(root)) throw new AppError("EVIDENCE_MISSING", `缺少 ${gateId} 私有证据`, 409);
  const artifacts: Array<{ logicalId: string; sha256: string }> = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new AppError("EVIDENCE_SYMLINK", "证据目录禁止符号链接", 409);
      if (entry.isDirectory()) walk(full);
      else {
        let isReceipt = false;
        if (entry.name.endsWith(".json")) {
          try {
            const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
            isReceipt = parsed?.schemaVersion === "human-gate-receipt-v1";
          } catch {
            // Non-receipt JSON remains part of the evidence bundle.
          }
        }
        if (!isReceipt)
          artifacts.push({
            logicalId: path.relative(root, full).replaceAll(path.sep, "/"),
            sha256: sha256(fs.readFileSync(full)),
          });
      }
    }
  };
  walk(root);
  if (artifacts.length === 0)
    throw new AppError("EVIDENCE_MISSING", `缺少 ${gateId} 私有证据文件`, 409);
  return artifacts.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
}

export function writePendingEvidence(root: string) {
  const pending = getDb()
    .prepare("SELECT * FROM human_gate_evidence_outbox WHERE status='pending' ORDER BY created_at")
    .all() as any[];
  const results = [];
  for (const row of pending) {
    const target = path.resolve(root, row.target_relpath);
    if (!target.startsWith(path.resolve(root)))
      throw new AppError("INVALID_EVIDENCE_PATH", "证据路径越界", 500);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, row.receipt_json);
    const hash = sha256(fs.readFileSync(temp));
    if (hash !== row.expected_file_hash)
      throw new AppError("EVIDENCE_HASH_MISMATCH", "证据 hash 不匹配", 500);
    fs.renameSync(temp, target);
    getDb()
      .prepare("UPDATE human_gate_evidence_outbox SET status='written',written_at=? WHERE id=?")
      .run(new Date().toISOString(), row.id);
    results.push(row.id);
  }
  return results;
}
