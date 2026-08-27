import { NextResponse } from "next/server";
import { deleteAiProvider, saveAiProvider } from "@/lib/ai-overlay";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

const allowed = ["label", "baseUrl", "model", "apiKey", "enabled"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ providerId: string }> },
) {
  try {
    migrate();
    const { providerId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "AI provider 请求必须是对象", 422);
    if (Object.keys(body).some((key) => !allowed.includes(key)))
      throw new AppError("UNKNOWN_FIELD", "AI provider 请求包含未知字段", 400);
    return NextResponse.json({ provider: saveAiProvider({ ...body, id: providerId }) });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ providerId: string }> },
) {
  try {
    migrate();
    const { providerId } = await context.params;
    deleteAiProvider(providerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
