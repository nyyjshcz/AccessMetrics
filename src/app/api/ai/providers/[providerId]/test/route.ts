import { NextResponse } from "next/server";
import { testAiProvider } from "@/lib/ai-overlay";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-security";
import { requireRequestRole } from "@/lib/access-control";

export async function POST(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    assertSameOrigin(request);
    requireRequestRole(request, "admin");
    migrate();
    const { providerId } = await context.params;
    return NextResponse.json(await testAiProvider(providerId));
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
