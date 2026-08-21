import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request, context: { params: Promise<{ exportId: string }> }) {
  try {
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    migrate();
    const { exportId } = await context.params;
    const body = await request.json();
    const changed = getDb()
      .prepare(
        "UPDATE study_exports SET publication_status='withdrawn',publication_revision=publication_revision+1,withdrawn_at=?,publication_error=? WHERE id=? AND publication_status='published' AND publication_revision=?",
      )
      .run(
        new Date().toISOString(),
        String(body.reason ?? "unpublished").slice(0, 500),
        exportId,
        body.expectedPublicationRevision,
      );
    if (changed.changes !== 1)
      throw new AppError("UNPUBLISH_CONFLICT", "只能撤下 published 且 revision 必须匹配", 409);
    return NextResponse.json({ exportId, publicationStatus: "withdrawn" });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
