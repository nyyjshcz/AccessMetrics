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
      throw new AppError("UNKNOWN_FIELD", "run 撤下不接受请求体字段", 400);
    const { runId } = await context.params;
    const result = getDb()
      .prepare("UPDATE scan_runs SET published=0,published_at=NULL WHERE id=? AND published=1")
      .run(runId);
    if (result.changes !== 1) throw new AppError("NOT_PUBLISHED", "扫描不存在或尚未发布", 409);
    return NextResponse.json({ runId, published: false });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
