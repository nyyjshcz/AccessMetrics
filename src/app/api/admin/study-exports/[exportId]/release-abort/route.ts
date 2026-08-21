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
    if (Object.keys(body).some((key) => !["expectedPublicationRevision", "reason"].includes(key)))
      throw new AppError("UNKNOWN_FIELD", "release abort 请求包含未定义字段", 400);
    if (
      !Number.isInteger(body.expectedPublicationRevision) ||
      typeof body.reason !== "string" ||
      body.reason.length > 500
    )
      throw new AppError("INVALID_INPUT", "release abort 参数无效", 422);
    const changed = getDb()
      .prepare(
        "UPDATE study_exports SET publication_status='unpublished',publication_revision=publication_revision+1,publication_error=? WHERE id=? AND publication_status='release_validating' AND publication_revision=?",
      )
      .run(
        String(body.reason ?? "release aborted").slice(0, 500),
        exportId,
        body.expectedPublicationRevision,
      );
    if (changed.changes !== 1)
      throw new AppError(
        "RELEASE_ABORT_CONFLICT",
        "只能 abort release_validating 且 revision 必须匹配",
        409,
      );
    return NextResponse.json({ exportId, publicationStatus: "unpublished" });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
