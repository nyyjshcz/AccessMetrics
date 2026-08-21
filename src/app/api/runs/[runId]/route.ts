import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { buildRunScore, serializeRunScore } from "@/lib/run-score";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await currentSession();
    const { runId } = await context.params;
    const run = getDb()
      .prepare(
        "SELECT r.*,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
      )
      .get(runId) as any;
    if (!run) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    if (!session && !run.published) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    const score = buildRunScore(runId);
    return NextResponse.json({ run, score: serializeRunScore(score) });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
