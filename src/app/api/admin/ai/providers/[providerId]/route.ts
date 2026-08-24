import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { deleteAiProvider, saveAiProvider } from "@/lib/ai-overlay";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { providerId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "AI provider 请求必须是对象", 422);
    const allowed = ["label", "baseUrl", "model", "apiKey", "enabled"];
    if (Object.keys(body).some((key) => !allowed.includes(key)))
      throw new AppError("UNKNOWN_FIELD", "AI provider 请求包含未定义字段", 400);
    return NextResponse.json({ provider: saveAiProvider({ ...body, id: providerId }) });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { providerId } = await context.params;
    deleteAiProvider(providerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
