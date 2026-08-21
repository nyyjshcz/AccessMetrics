import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { id } from "@/lib/ids";
import { canonicalize, sha256 } from "@/lib/canonical";
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
      .get(sampleId, batchId);
    if (!sample) throw new AppError("NOT_FOUND", "抽样节点不存在", 404);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "裁决请求必须是对象", 422);
    if (Object.keys(body).some((key) => !["adjudicatedVerdict", "resolutionNote"].includes(key)))
      throw new AppError("UNKNOWN_FIELD", "裁决请求包含未定义字段", 400);
    const verdict = String(body.adjudicatedVerdict ?? "");
    if (!["confirmed", "not_an_issue", "uncertain"].includes(verdict))
      throw new AppError("INVALID_ADJUDICATION", "裁决 verdict 无效", 422);
    const resolutionNote = String(body.resolutionNote ?? "");
    if (resolutionNote.length > 2000)
      throw new AppError("INVALID_NOTE", "resolutionNote 最多 2000 个字符", 422);
    const resolutionHash = sha256(canonicalize({ sampleId, verdict, resolutionNote }));
    const adjudicationId = id("adjudication");
    getDb()
      .prepare(
        "INSERT INTO manual_review_adjudications(id,sample_id,adjudicated_verdict,resolution_note,resolution_hash,revision,status,proposed_by,proposed_at,is_current) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        adjudicationId,
        sampleId,
        verdict,
        resolutionNote,
        resolutionHash,
        1,
        "proposed",
        session.user.role,
        new Date().toISOString(),
        0,
      );
    return NextResponse.json(
      { adjudicationId, status: "proposed", resolutionHash },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
