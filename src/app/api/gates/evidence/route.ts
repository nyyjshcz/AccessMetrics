import { NextResponse } from "next/server";
import { csrfMatches, requireRole, reviewerReauthMatches } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { deriveGateArtifacts, submitGateEvidence } from "@/lib/study";
import { r5GateArtifacts } from "@/lib/r5";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("computer_reviewer", "math_reviewer");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "gate 请求必须是对象", 422);
    if ("role" in body || "reviewer" in body || "artifacts" in body)
      throw new AppError("UNKNOWN_FIELD", "role/reviewer/artifacts 由服务端计算", 400);
    const allowed = new Set([
      "gateId",
      "campaignId",
      "decision",
      "statementVersion",
      "boundCommit",
      "note",
      "reauthReviewToken",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "gate 请求包含未定义字段", 400);
    const reviewerRole =
      session.user.role === "computer_reviewer" ? "computer_reviewer" : "math_reviewer";
    if (
      typeof body.reauthReviewToken !== "string" ||
      !reviewerReauthMatches(reviewerRole, body.reauthReviewToken)
    )
      throw new AppError("REAUTH_REQUIRED", "需要当前 reviewer 的二次认证 token", 403);
    if (typeof body.note !== "string" || body.note.length > 2000)
      throw new AppError("INVALID_NOTE", "note 最多 2000 个字符", 422);
    if (!["approved", "rejected"].includes(body.decision))
      throw new AppError("INVALID_GATE_DECISION", "decision 必须是 approved 或 rejected", 422);
    if (body.campaignId !== undefined && typeof body.campaignId !== "string")
      throw new AppError("INVALID_INPUT", "campaignId 必须是字符串", 422);
    if (
      body.boundCommit !== undefined &&
      (typeof body.boundCommit !== "string" || body.boundCommit.length > 128)
    )
      throw new AppError("INVALID_INPUT", "boundCommit 无效", 422);
    if (!body.gateId || !["R1", "R2", "R3", "R4", "R5"].includes(body.gateId))
      throw new AppError("INVALID_GATE", "gateId 无效", 422);
    if (body.gateId === "R5" && typeof body.boundCommit !== "string")
      throw new AppError("R5_BUNDLE_REQUIRED", "R5 必须明确绑定 rcCommit", 409);
    const role = reviewerRole === "computer_reviewer" ? "computer_lead" : "math_lead";
    const artifacts =
      body.gateId === "R5" ? r5GateArtifacts(body.boundCommit) : deriveGateArtifacts(body.gateId);
    const result = submitGateEvidence({
      gateId: body.gateId,
      campaignId: body.campaignId,
      decision: body.decision,
      statementVersion: body.statementVersion ?? "human-gate-v1",
      boundCommit: body.boundCommit,
      artifacts,
      note: body.note,
      role,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
