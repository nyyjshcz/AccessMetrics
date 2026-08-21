import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { id } from "@/lib/ids";
import { AppError, errorEnvelope } from "@/lib/errors";

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
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "审核请求必须是对象", 422);
    if (Object.keys(body).some((key) => !["verdict", "note"].includes(key)))
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
    const reviewId = id("review");
    getDb().transaction(() => {
      if (previous)
        getDb().prepare("UPDATE manual_reviews SET is_current=0 WHERE id=?").run(previous.id);
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
    return NextResponse.json({ reviewId, sampleId, reviewer, verdict }, { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
