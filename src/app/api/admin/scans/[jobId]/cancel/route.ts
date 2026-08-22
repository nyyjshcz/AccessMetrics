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
    const db = getDb();
    const result = db.transaction(() => {
      const timestamp = new Date().toISOString();
      const changed = db
        .prepare(
          "UPDATE scan_jobs SET status='cancelled',finished_at=? WHERE id=? AND status IN ('queued','running','paused')",
        )
        .run(timestamp, jobId);
      if (changed.changes)
        db.prepare(
          "UPDATE job_pages SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND status IN ('queued','discovered','leased','scanning')",
        ).run(timestamp, jobId);
      return changed;
    })();
    if (!result.changes) throw new AppError("CANCEL_CONFLICT", "任务不存在或已结束", 409);
    return NextResponse.json({ jobId, status: "cancelled" }, { status: 202 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
