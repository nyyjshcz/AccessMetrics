import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { getAiBatch, pauseAiBatch, resumeAiBatch, retryAiBatch } from "@/lib/ai-overlay";

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    migrate();
    await requireRole("admin");
    const { batchId } = await context.params;
    return NextResponse.json(getAiBatch(batchId));
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { batchId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || !["pause", "resume", "retry"].includes(body.action))
      throw new AppError("INVALID_INPUT", "action 必须是 pause、resume 或 retry", 422);
    const result =
      body.action === "pause"
        ? pauseAiBatch(batchId)
        : body.action === "resume"
          ? resumeAiBatch(batchId)
          : retryAiBatch(batchId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
