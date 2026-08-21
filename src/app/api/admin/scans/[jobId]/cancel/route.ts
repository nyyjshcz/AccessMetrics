import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { jobId } = await context.params;
    const result = getDb()
      .prepare(
        "UPDATE scan_jobs SET status='cancelled',finished_at=? WHERE id=? AND status IN ('queued','running','paused')",
      )
      .run(new Date().toISOString(), jobId);
    if (!result.changes) throw new AppError("CANCEL_CONFLICT", "任务不存在或已结束", 409);
    return NextResponse.json({ jobId, status: "cancelled" });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
