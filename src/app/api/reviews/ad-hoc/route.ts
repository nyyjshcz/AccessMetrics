import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { id } from "@/lib/ids";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("computer_reviewer", "math_reviewer");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "审核请求必须是对象", 422);
    const allowed = new Set([
      "resultNodeId",
      "verdict",
      "note",
      "supersedesReviewId",
      "expectedRevision",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "ad-hoc 审核只能提交节点、verdict 和 note", 400);
    const resultNodeId = String(body.resultNodeId ?? "");
    const verdict = String(body.verdict ?? "");
    const note = String(body.note ?? "");
    if (note.length > 2000) throw new AppError("INVALID_NOTE", "note 最多 2000 个字符", 422);
    if (!resultNodeId || !["confirmed", "not_an_issue", "uncertain"].includes(verdict))
      throw new AppError("INVALID_REVIEW", "审核对象或 verdict 无效", 422);
    const node = getDb()
      .prepare(
        "SELECT n.id,rr.result_type FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id WHERE n.id=?",
      )
      .get(resultNodeId) as any;
    if (!node) throw new AppError("NOT_FOUND", "节点不存在", 404);
    if (!["violation", "incomplete"].includes(node.result_type))
      throw new AppError("REVIEW_NOT_ALLOWED", "只有 violation/incomplete 节点可以人工审核", 422);
    const reviewer = session.user.role === "computer_reviewer" ? "computer_lead" : "math_lead";
    const context = "ad_hoc";
    const previous = getDb()
      .prepare(
        "SELECT id,revision FROM manual_reviews WHERE result_node_id=? AND reviewer=? AND review_context=? AND is_current=1 ORDER BY revision DESC,reviewed_at DESC,id DESC LIMIT 1",
      )
      .get(resultNodeId, reviewer, context) as any;
    if (previous) {
      if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== previous.revision)
        throw new AppError("REVIEW_REVISION_CONFLICT", "审核 revision 已变化，请刷新后重试", 409);
      if (body.supersedesReviewId !== previous.id)
        throw new AppError("REVIEW_REVISION_CONFLICT", "supersedesReviewId 必须指向当前审核", 409);
    } else if (body.expectedRevision !== undefined || body.supersedesReviewId !== undefined) {
      throw new AppError("REVIEW_REVISION_CONFLICT", "首次审核不能提交修订字段", 409);
    }
    const revision = previous ? previous.revision + 1 : 1;
    const inserted = id("review");
    try {
      getDb().transaction(() => {
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
            "INSERT INTO manual_reviews(id,result_node_id,review_context,reviewer,verdict,note,revision,supersedes_review_id,is_current,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            inserted,
            resultNodeId,
            context,
            reviewer,
            verdict,
            note,
            revision,
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
    return NextResponse.json({ reviewId: inserted, reviewer, revision, verdict }, { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
