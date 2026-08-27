import { getDb } from "./db";
import { AppError } from "./errors";
import { id } from "./ids";

export const RESOLUTION_VERDICTS = ["problem", "not_problem", "uncertain"] as const;
export type ResolutionVerdict = (typeof RESOLUTION_VERDICTS)[number];

/** The only precedence rule used by the local scan flow. */
export function loadLocalManualVerdicts(runId: string) {
  const rows = getDb()
    .prepare(
      `SELECT mr.result_node_id,mr.verdict,mr.reviewed_at,mr.id
       FROM manual_reviews mr
       JOIN result_nodes n ON n.id=mr.result_node_id
       JOIN rule_results rr ON rr.id=n.rule_result_id
       WHERE rr.run_id=? AND mr.sample_id IS NULL
         AND mr.review_context='ad_hoc' AND mr.reviewer='local' AND mr.is_current=1
       ORDER BY mr.reviewed_at DESC,mr.id DESC`,
    )
    .all(runId) as Array<{ result_node_id: string; verdict: string; reviewed_at: string; id: string }>;
  const result = new Map<string, ResolutionVerdict>();
  for (const row of rows) {
    if (!RESOLUTION_VERDICTS.includes(row.verdict as ResolutionVerdict)) continue;
    if (!result.has(row.result_node_id)) result.set(row.result_node_id, row.verdict as ResolutionVerdict);
  }
  return result;
}

/** Merge AI results without ever allowing them to replace a local decision. */
export function applyHumanPrecedence(
  ai: ReadonlyMap<string, ResolutionVerdict>,
  human: ReadonlyMap<string, ResolutionVerdict>,
) {
  const result = new Map(ai);
  for (const [nodeId, verdict] of human) result.set(nodeId, verdict);
  return result;
}

export function resolveRunVerdicts(
  runId: string,
  ai: ReadonlyMap<string, ResolutionVerdict> = new Map(),
) {
  return applyHumanPrecedence(ai, loadLocalManualVerdicts(runId));
}

export function isRunPublished(runId: string) {
  const row = getDb().prepare("SELECT published FROM scan_runs WHERE id=?").get(runId) as
    | { published: number }
    | undefined;
  return row?.published === 1;
}

export function assertRunMutable(runId: string) {
  if (isRunPublished(runId)) {
    throw new AppError("RUN_PUBLISHED_READ_ONLY", "已发布扫描为只读，请创建新的扫描任务", 409);
  }
}

export function hasActiveAiBatch(runId: string) {
  const row = getDb()
    .prepare(
      "SELECT id FROM ai_review_batches WHERE run_id=? AND page_id IS NULL AND study_freeze_id IS NULL AND status IN ('queued','running') LIMIT 1",
    )
    .get(runId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function assertManualEditingAllowed(runId: string) {
  assertRunMutable(runId);
  if (hasActiveAiBatch(runId)) {
    throw new AppError(
      "AI_REVIEW_ACTIVE",
      "AI 批处理运行期间不能修改人工结论；请先暂停或等待它结束",
      409,
    );
  }
}

export function saveLocalManualVerdict(input: {
  runId: string;
  resultNodeId: string;
  verdict: ResolutionVerdict;
  note?: string | null;
}) {
  if (!RESOLUTION_VERDICTS.includes(input.verdict))
    throw new AppError("MANUAL_VERDICT_INVALID", "人工结论必须是 problem、not_problem 或 uncertain", 422);
  assertManualEditingAllowed(input.runId);
  const timestamp = new Date().toISOString();
  const note = String(input.note ?? "").trim().slice(0, 4000);
  const db = getDb();
  const node = db
    .prepare(
      `SELECT n.id
       FROM result_nodes n
       JOIN rule_results rr ON rr.id=n.rule_result_id
       WHERE n.id=? AND rr.run_id=? AND rr.result_type='incomplete'`,
    )
    .get(input.resultNodeId, input.runId) as { id: string } | undefined;
  if (!node) throw new AppError("INCOMPLETE_NODE_NOT_FOUND", "待判断节点不存在", 404);
  const existing = db
    .prepare(
      `SELECT id,revision
       FROM manual_reviews
       WHERE result_node_id=? AND sample_id IS NULL AND review_context='ad_hoc'
         AND reviewer='local' AND is_current=1
       LIMIT 1`,
    )
    .get(input.resultNodeId) as { id: string; revision: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE manual_reviews SET verdict=?,note=?,reviewed_at=? WHERE id=? AND is_current=1",
    ).run(input.verdict, note, timestamp, existing.id);
    return { reviewId: existing.id, updated: true, reviewedAt: timestamp };
  }
  const reviewId = id("manual");
  db.prepare(
    "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,supersedes_review_id,is_current,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    reviewId,
    input.resultNodeId,
    null,
    "ad_hoc",
    "local",
    input.verdict,
    note,
    1,
    null,
    1,
    timestamp,
  );
  return { reviewId, updated: false, reviewedAt: timestamp };
}
