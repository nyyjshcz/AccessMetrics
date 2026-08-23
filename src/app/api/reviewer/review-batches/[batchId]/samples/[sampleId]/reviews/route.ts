import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { id } from "@/lib/ids";
import { AppError, errorEnvelope } from "@/lib/errors";
import { invalidateStudyReviewChain } from "@/lib/study";

export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string; sampleId: string }> },
) {
  try {
    migrate();
    const session = await requireRole("computer_reviewer", "math_reviewer");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { batchId, sampleId } = await context.params;
    if (
      getDb()
        .prepare(
          "SELECT 1 FROM review_freezes WHERE batch_id=? AND status='verified' AND is_current=1",
        )
        .get(batchId)
    )
      throw new AppError("REVIEW_FROZEN", "review set 已冻结，不能继续修改", 409);
    const sample = getDb()
      .prepare("SELECT * FROM manual_review_samples WHERE id=? AND batch_id=?")
      .get(sampleId, batchId) as any;
    if (!sample) throw new AppError("NOT_FOUND", "抽样节点不存在", 404);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "审核请求必须是对象", 422);
    if (
      Object.keys(body).some(
        (key) => !["verdict", "note", "supersedesReviewId", "expectedRevision"].includes(key),
      )
    )
      throw new AppError("UNKNOWN_FIELD", "审核请求包含未定义字段", 400);
    const verdict = String(body.verdict ?? "");
    if (!["confirmed", "not_an_issue", "uncertain"].includes(verdict))
      throw new AppError("INVALID_REVIEW", "verdict 无效", 422);
    if (String(body.note ?? "").length > 2000)
      throw new AppError("INVALID_NOTE", "note 最多 2000 个字符", 422);
    const reviewer = session.user.role === "computer_reviewer" ? "computer_lead" : "math_lead";
    const previous = getDb()
      .prepare(
        "SELECT id,revision FROM manual_reviews WHERE sample_id=? AND reviewer=? AND review_context='formal' AND is_current=1",
      )
      .get(sampleId, reviewer) as any;
    const suppliedRevision = body.expectedRevision;
    const suppliedSupersedes = body.supersedesReviewId;
    if (previous) {
      if (!Number.isInteger(suppliedRevision) || suppliedRevision !== previous.revision)
        throw new AppError("REVIEW_REVISION_CONFLICT", "审核 revision 已变化，请刷新后重试", 409);
      if (suppliedSupersedes !== previous.id)
        throw new AppError("REVIEW_REVISION_CONFLICT", "supersedesReviewId 必须指向当前审核", 409);
    } else if (suppliedRevision !== undefined || suppliedSupersedes !== undefined) {
      throw new AppError("REVIEW_REVISION_CONFLICT", "首次审核不能提交修订字段", 409);
    }
    const reviewId = id("review");
    try {
      getDb().transaction(() => {
        if (previous) invalidateStudyReviewChain(getDb(), batchId);
        if (previous) {
          const retired = getDb()
            .prepare(
              "UPDATE manual_reviews SET is_current=0 WHERE id=? AND is_current=1 AND revision=?",
            )
            .run(previous.id, previous.revision);
          if (!retired.changes)
            throw new AppError("REVIEW_REVISION_CONFLICT", "审核已被其他请求修订", 409);
        }
        getDb()
          .prepare(
            "INSERT INTO manual_reviews(id,result_node_id,sample_id,review_context,reviewer,verdict,note,revision,supersedes_review_id,is_current,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            reviewId,
            sample.result_node_id,
            sampleId,
            "formal",
            reviewer,
            verdict,
            String(body.note ?? ""),
            previous ? previous.revision + 1 : 1,
            previous?.id ?? null,
            1,
            new Date().toISOString(),
          );
      })();
    } catch (error) {
      if (
        String((error as { code?: string } | undefined)?.code ?? "").startsWith("SQLITE_CONSTRAINT")
      )
        throw new AppError("REVIEW_REVISION_CONFLICT", "审核已被其他请求提交，请刷新后重试", 409);
      throw error;
    }
    return NextResponse.json({ reviewId, sampleId, reviewer, verdict }, { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
