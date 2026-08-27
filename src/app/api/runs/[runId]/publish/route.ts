import { NextResponse } from "next/server";
import { getDb, migrate, transaction } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { renderRunReport } from "@/lib/report";

export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const { runId } = await context.params;
    const run = getDb().prepare("SELECT status,published FROM scan_runs WHERE id=?").get(runId) as
      | { status: string; published: number }
      | undefined;
    if (!run) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    if (run.published) throw new AppError("RUN_PUBLISHED_READ_ONLY", "该扫描已经发布并归档", 409);
    if (!['completed', 'completed_with_errors'].includes(run.status))
      throw new AppError("RUN_NOT_COMPLETE", "扫描未完成，不能发布", 409);
    const active = getDb()
      .prepare(
        "SELECT id FROM ai_review_batches WHERE run_id=? AND page_id IS NULL AND study_freeze_id IS NULL AND status IN ('queued','running') LIMIT 1",
      )
      .get(runId) as { id: string } | undefined;
    if (active)
      throw new AppError("AI_REVIEW_ACTIVE", "AI 批处理仍在运行，暂停或完成后才能发布", 409, {
        batchId: active.id,
      });
    const report = renderRunReport(runId);
    const publishedAt = new Date().toISOString();
    transaction((db) => {
      const result = db
        .prepare("UPDATE scan_runs SET published=1,published_at=? WHERE id=? AND published=0")
        .run(publishedAt, runId);
      if (result.changes !== 1)
        throw new AppError("RUN_PUBLISH_CONFLICT", "扫描发布状态已改变，请刷新后重试", 409);
    });
    return NextResponse.json({ runId, published: true, publishedAt, report: report.file });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
