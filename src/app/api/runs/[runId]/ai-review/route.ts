import { NextResponse } from "next/server";
import { createAiBatch, summarizeAiRun } from "@/lib/ai-overlay";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const { runId } = await context.params;
    if (!getDb().prepare("SELECT id FROM scan_runs WHERE id=?").get(runId))
      throw new AppError("NOT_FOUND", "扫描不存在", 404);
    const providerConfigId = new URL(request.url).searchParams.get("providerConfigId") || undefined;
    const summary = summarizeAiRun(runId, providerConfigId);
    return NextResponse.json({ ...summary, overlay: undefined, aiOverlay: undefined });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    assertSameOrigin(request);
    migrate();
    const { runId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "AI batch 请求必须是对象", 422);
    if (Object.keys(body).some((key) => key !== "providerConfigId"))
      throw new AppError("UNKNOWN_FIELD", "AI batch 请求包含未知字段", 400);
    if (typeof body.providerConfigId !== "string" || !body.providerConfigId)
      throw new AppError("INVALID_INPUT", "providerConfigId 必填", 422);
    const result = createAiBatch({ runId, providerConfigId: body.providerConfigId });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
