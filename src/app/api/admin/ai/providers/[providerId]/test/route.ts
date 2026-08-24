import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { testAiProvider } from "@/lib/ai-overlay";

export async function POST(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { providerId } = await context.params;
    return NextResponse.json(await testAiProvider(providerId));
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
