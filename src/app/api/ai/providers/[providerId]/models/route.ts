import { NextResponse } from "next/server";
import { listProviderModels } from "@/lib/ai-overlay";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { requireRequestRole } from "@/lib/access-control";

export async function GET(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    requireRequestRole(request, "admin");
    migrate();
    const { providerId } = await context.params;
    return NextResponse.json({ models: await listProviderModels(providerId) });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
