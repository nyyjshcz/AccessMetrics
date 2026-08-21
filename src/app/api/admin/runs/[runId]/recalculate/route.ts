import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { buildRunScore, serializeRunScore } from "@/lib/run-score";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    if (Object.keys(body).some((key) => key !== "expectedModelVersion"))
      throw new AppError("UNKNOWN_FIELD", "重算请求包含未定义字段", 400);
    if (body.expectedModelVersion !== "accesscheck-score-v1")
      throw new AppError("MODEL_VERSION_MISMATCH", "评分模型版本不匹配", 409);
    const { runId } = await context.params;
    if (!getDb().prepare("SELECT id FROM scan_runs WHERE id=?").get(runId))
      throw new AppError("NOT_FOUND", "扫描不存在", 404);
    return NextResponse.json({
      runId,
      modelVersion: body.expectedModelVersion,
      score: serializeRunScore(buildRunScore(runId)),
      validated: true,
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
