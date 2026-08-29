import { NextResponse } from "next/server";
import { deleteTerminalScanJob, getJob } from "@/lib/repositories";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    migrate();
    const { jobId } = await context.params;
    const job = getJob(jobId);
    if (!job) throw new AppError("NOT_FOUND", "任务不存在", 404);
    const progressRows = getDb()
      .prepare(
        "SELECT jp.status,p.scan_status,COUNT(*) count FROM job_pages jp JOIN pages p ON p.id=jp.page_id WHERE jp.job_id=? GROUP BY jp.status,p.scan_status",
      )
      .all(jobId) as Array<{ status: string; scan_status: string; count: number }>;
    const count = (status: string, scanStatus?: string) =>
      progressRows
        .filter((row) => row.status === status && (!scanStatus || row.scan_status === scanStatus))
        .reduce((sum, row) => sum + Number(row.count), 0);
    const progress = {
      discovered: progressRows.reduce((sum, row) => sum + Number(row.count), 0),
      queued: count("discovered"),
      scanning: count("scanning"),
      success: count("completed", "success"),
      deduplicated: count("completed", "skipped"),
      failed: count("failed"),
      cancelled: count("cancelled"),
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

export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    assertSameOrigin(request);
    migrate();
    const { jobId } = await context.params;
    const deleted = deleteTerminalScanJob(jobId);
    return NextResponse.json({ ok: true, ...deleted });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
