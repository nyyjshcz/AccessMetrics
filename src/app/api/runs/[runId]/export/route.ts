import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { exportRun } from "@/lib/export";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin", "computer_reviewer", "math_reviewer");
    if (!csrfMatches(session, _request.headers.get("x-csrf-token")))
      throw new AppError("CSRF", "缺少或无效的 CSRF token", 403);
    const { runId } = await context.params;
    return NextResponse.json(exportRun(runId), { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
