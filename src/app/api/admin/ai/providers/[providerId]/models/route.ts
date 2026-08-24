import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { listProviderModels } from "@/lib/ai-overlay";

export async function GET(_request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    migrate();
    await requireRole("admin");
    const { providerId } = await context.params;
    return NextResponse.json({ models: await listProviderModels(providerId) });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
