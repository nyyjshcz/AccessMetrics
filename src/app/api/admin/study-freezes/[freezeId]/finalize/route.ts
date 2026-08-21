import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { finalizeStudyFreeze } from "@/lib/study";

export async function POST(request: Request, context: { params: Promise<{ freezeId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    const allowed = new Set([
      "reportLocalizationHash",
      "modelDecisionHash",
      "modelObservationsHash",
    ]);
    if (!body || typeof body !== "object" || Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "finalize 请求包含未定义字段", 400);
    if (Object.keys(body).length !== 3)
      throw new AppError("INVALID_INPUT", "finalize 需要三个 hash", 422);
    const { freezeId } = await context.params;
    return NextResponse.json(finalizeStudyFreeze({ freezeId, ...body }), { status: 200 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
