import { NextResponse } from "next/server";
import { migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import {
  clearLocalManualVerdict,
  RESOLUTION_VERDICTS,
  saveLocalManualVerdict,
} from "@/lib/incomplete-resolution";
import { assertSameOrigin } from "@/lib/request-security";
import { requireRequestRole } from "@/lib/access-control";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; nodeId: string }> },
) {
  try {
    assertSameOrigin(request);
    requireRequestRole(request, "admin");
    migrate();
    const { runId, nodeId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "人工结论必须是对象", 422);
    if (Object.keys(body).some((key) => key !== "verdict" && key !== "note"))
      throw new AppError("UNKNOWN_FIELD", "人工结论包含未知字段", 400);
    if (!RESOLUTION_VERDICTS.includes(body.verdict))
      throw new AppError("MANUAL_VERDICT_INVALID", "verdict 必须是 problem、not_problem 或 uncertain", 422);
    if (body.note !== undefined && typeof body.note !== "string")
      throw new AppError("MANUAL_NOTE_INVALID", "备注必须是文本", 422);
    return NextResponse.json(
      saveLocalManualVerdict({ runId, resultNodeId: nodeId, verdict: body.verdict, note: body.note }),
    );
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ runId: string; nodeId: string }> },
) {
  try {
    assertSameOrigin(request);
    requireRequestRole(request, "admin");
    migrate();
    const { runId, nodeId } = await context.params;
    return NextResponse.json(clearLocalManualVerdict({ runId, resultNodeId: nodeId }));
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
