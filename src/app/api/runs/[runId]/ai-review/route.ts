import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { createAiBatch, getAiBatch, summarizeAiRun } from "@/lib/ai-overlay";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    await requireRole("admin");
    const { runId } = await context.params;
    const pageId = new URL(_request.url).searchParams.get("pageId");
    return NextResponse.json(summarizeAiRun(runId, pageId));
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { runId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "AI batch 请求必须是对象", 422);
    if (Object.keys(body).some((key) => !["pageId", "providerConfigId"].includes(key)))
      throw new AppError("UNKNOWN_FIELD", "AI batch 请求包含未定义字段", 400);
    if (!body.providerConfigId) throw new AppError("INVALID_INPUT", "providerConfigId 必填", 422);
    const run = getDb().prepare("SELECT id FROM scan_runs WHERE id=?").get(runId);
    if (!run) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    if (body.pageId) {
      const page = getDb()
        .prepare("SELECT id FROM pages WHERE id=? AND run_id=?")
        .get(body.pageId, runId);
      if (!page) throw new AppError("PAGE_NOT_FOUND", "页面不属于当前扫描", 404);
    }
    return NextResponse.json(
      createAiBatch({
        runId,
        pageId: body.pageId ?? null,
        providerConfigId: body.providerConfigId,
      }),
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
