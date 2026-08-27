import { NextResponse } from "next/server";
import { listAiProviders, saveAiProvider } from "@/lib/ai-overlay";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

const allowed = ["id", "label", "baseUrl", "model", "apiKey", "enabled"];

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    migrate();
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
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "AI provider 请求必须是对象", 422);
    if (Object.keys(body).some((key) => !allowed.includes(key)))
      throw new AppError("UNKNOWN_FIELD", "AI provider 请求包含未知字段", 400);
    return NextResponse.json({ provider: saveAiProvider(body) }, { status: body.id ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
