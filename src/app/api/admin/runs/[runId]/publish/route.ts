import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json().catch(() => ({}));
    if (Object.keys(body).length > 0)
      throw new AppError("UNKNOWN_FIELD", "run 发布不接受请求体字段", 400);
    const { runId } = await context.params;
    const run = getDb()
      .prepare("SELECT status,published FROM scan_runs WHERE id=?")
      .get(runId) as any;
    if (!run) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    if (!["completed", "completed_with_errors"].includes(run.status))
      throw new AppError("RUN_NOT_COMPLETE", "扫描未完成，不能发布", 409);
    const now = new Date().toISOString();
    getDb()
      .prepare("UPDATE scan_runs SET published=1,published_at=? WHERE id=? AND published=0")
      .run(now, runId);
    return NextResponse.json({ runId, published: true, publishedAt: now });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
