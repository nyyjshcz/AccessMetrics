import { NextResponse } from "next/server";
import { deleteTerminalScanJob, getJob } from "@/lib/repositories";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope, localizedErrorMessage, localeFromRequest } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/request-security";
import { requireRequestRole } from "@/lib/access-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    requireRequestRole(request, "admin");
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
    const locale = localeFromRequest(request);
    const failureCode = typeof job.error_code === "string" ? job.error_code : null;
    const failureMessage = failureCode
      ? (localizedErrorMessage(failureCode, locale) ??
        (locale === "en" ? "The scan failed before page discovery" : "扫描在页面发现前失败"))
      : null;
    const run = getDb()
      .prepare(
        "SELECT id,status,published FROM scan_runs WHERE job_id=? ORDER BY started_at DESC LIMIT 1",
      )
      .get(jobId);
    const currentPage = getDb()
      .prepare(
        "SELECT p.id,p.canonical_url,jp.status FROM job_pages jp JOIN pages p ON p.id=jp.page_id WHERE jp.job_id=? AND jp.status='scanning' ORDER BY jp.discovery_order LIMIT 1",
      )
      .get(jobId);
    return NextResponse.json({
      job,
      progress,
      failure: failureCode ? { code: failureCode, message: failureMessage } : null,
      currentPage: currentPage ?? null,
      run: run ?? null,
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    assertSameOrigin(request);
    requireRequestRole(request, "admin");
    migrate();
    const { jobId } = await context.params;
    const deleted = deleteTerminalScanJob(jobId);
    return NextResponse.json({ ok: true, ...deleted });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
