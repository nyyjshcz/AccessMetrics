import { NextResponse } from "next/server";
import { getJob } from "@/lib/repositories";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    migrate();
    const { jobId } = await context.params;
    const job = getJob(jobId);
    if (!job) throw new AppError("NOT_FOUND", "任务不存在", 404);
    const progressRows = getDb()
      .prepare("SELECT status,COUNT(*) count FROM job_pages WHERE job_id=? GROUP BY status")
      .all(jobId) as Array<{ status: string; count: number }>;
    const progress = {
      discovered: progressRows.reduce((sum, row) => sum + Number(row.count), 0),
      queued: Number(progressRows.find((row) => row.status === "discovered")?.count ?? 0),
      scanning: Number(progressRows.find((row) => row.status === "scanning")?.count ?? 0),
      success: Number(progressRows.find((row) => row.status === "completed")?.count ?? 0),
      failed: Number(progressRows.find((row) => row.status === "failed")?.count ?? 0),
      cancelled: Number(progressRows.find((row) => row.status === "cancelled")?.count ?? 0),
    };
    const run = getDb()
      .prepare("SELECT id,status,published FROM scan_runs WHERE job_id=? ORDER BY started_at DESC LIMIT 1")
      .get(jobId);
    const currentPage = getDb()
      .prepare(
        "SELECT p.id,p.canonical_url,jp.status FROM job_pages jp JOIN pages p ON p.id=jp.page_id WHERE jp.job_id=? AND jp.status='scanning' ORDER BY jp.discovery_order LIMIT 1",
      )
      .get(jobId);
    return NextResponse.json({ job, progress, currentPage: currentPage ?? null, run: run ?? null });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
