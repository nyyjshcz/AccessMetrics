import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { listAiProviders, saveAiProvider } from "@/lib/ai-overlay";

export async function GET() {
  try {
    migrate();
    await requireRole("admin");
    return NextResponse.json({ providers: listAiProviders() });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "AI provider 请求必须是对象", 422);
    const allowed = ["id", "label", "baseUrl", "model", "apiKey", "enabled"];
    if (Object.keys(body).some((key) => !allowed.includes(key)))
      throw new AppError("UNKNOWN_FIELD", "AI provider 请求包含未定义字段", 400);
    return NextResponse.json({ provider: saveAiProvider(body) }, { status: body.id ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
