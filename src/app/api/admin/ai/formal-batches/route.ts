import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { createAiBatch, formalBatchStats } from "@/lib/ai-overlay";

export async function GET(request: Request) {
  try {
    migrate();
    await requireRole("admin");
    const studyFreezeId = new URL(request.url).searchParams.get("studyFreezeId");
    if (!studyFreezeId) throw new AppError("INVALID_INPUT", "studyFreezeId 必填", 422);
    return NextResponse.json(formalBatchStats(studyFreezeId));
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
    if (!body?.studyFreezeId || !body?.providerConfigId)
      throw new AppError("INVALID_INPUT", "studyFreezeId/providerConfigId 必填", 422);
    return NextResponse.json(
      createAiBatch({ studyFreezeId: body.studyFreezeId, providerConfigId: body.providerConfigId }),
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
