import { NextResponse } from "next/server";
import { getAiBatch, pauseAiBatch, resumeAiBatch, retryAiBatch } from "@/lib/ai-overlay";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-security";
import { requireRequestRole } from "@/lib/access-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    requireRequestRole(request, "admin");
    migrate();
    const { batchId } = await context.params;
    return NextResponse.json(getAiBatch(batchId));
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    assertSameOrigin(request);
    requireRequestRole(request, "admin");
    migrate();
    const { batchId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || !["pause", "resume", "retry"].includes(body.action))
      throw new AppError("INVALID_INPUT", "action 必须是 pause、resume 或 retry", 422);
    const result =
      body.action === "pause"
        ? pauseAiBatch(batchId)
        : body.action === "resume"
          ? resumeAiBatch(batchId)
          : retryAiBatch(batchId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
