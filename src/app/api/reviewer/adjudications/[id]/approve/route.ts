import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { invalidateStudyReviewChain } from "@/lib/study";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    migrate();
    const session = await requireRole("computer_reviewer", "math_reviewer");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "批准请求必须是对象", 422);
    if (Object.keys(body).some((key) => !["resolutionHash", "expectedRevision"].includes(key)))
      throw new AppError("UNKNOWN_FIELD", "批准请求包含未定义字段", 400);
    if (typeof body.resolutionHash !== "string" || !/^[a-f0-9]{64}$/.test(body.resolutionHash))
      throw new AppError("INVALID_HASH", "resolutionHash 必须是 SHA-256", 422);
    if (!Number.isInteger(body.expectedRevision))
      throw new AppError("ADJUDICATION_REVISION_CONFLICT", "expectedRevision 必须是整数", 409);
    const row = getDb()
      .prepare(
        "SELECT * FROM manual_review_adjudications WHERE id=? AND status='proposed' AND is_current=0",
      )
      .get(id) as any;
    if (!row) throw new AppError("NOT_FOUND", "待批准裁决不存在", 404);
    if (row.resolution_hash !== body.resolutionHash || row.revision !== body.expectedRevision)
      throw new AppError("ADJUDICATION_REVISION_CONFLICT", "裁决内容或 revision 已变化", 409);
    if (row.proposed_by === session.user.role)
      throw new AppError("INDEPENDENCE_REQUIRED", "裁决批准人不能与提出人相同", 403);
    const db = getDb();
    const updated = db.transaction(() => {
      const current = db
        .prepare("SELECT sample_id FROM manual_review_adjudications WHERE id=?")
        .get(id) as { sample_id: string } | undefined;
      if (!current) return 0;
      const batch = db
        .prepare(
          "SELECT mrs.batch_id FROM manual_review_samples mrs WHERE mrs.id=(SELECT sample_id FROM manual_review_adjudications WHERE id=?)",
        )
        .get(id) as { batch_id: string } | undefined;
      if (batch) invalidateStudyReviewChain(db, batch.batch_id);
      db.prepare(
        "UPDATE manual_review_adjudications SET is_current=0 WHERE sample_id=? AND id<>? AND is_current=1",
      ).run(current.sample_id, id);
      const changed = db
        .prepare(
          "UPDATE manual_review_adjudications SET status='approved',approved_by=?,approved_at=?,is_current=1 WHERE id=? AND status='proposed' AND is_current=0 AND revision=? AND resolution_hash=?",
        )
        .run(
          session.user.role,
          new Date().toISOString(),
          id,
          body.expectedRevision,
          body.resolutionHash,
        );
      if (!changed.changes) return 0;
      return changed.changes;
    })();
    if (!updated) throw new AppError("ADJUDICATION_CONFLICT", "裁决已被其他人处理", 409);
    return NextResponse.json({ adjudicationId: id, status: "approved" });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
