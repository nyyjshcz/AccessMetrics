import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { createStudyExport } from "@/lib/study-export";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "study export 请求必须是对象", 422);
    if (
      Object.keys(body).some(
        (key) =>
          !["studyFreezeId", "kind", "expectedSourceExportId", "expectedOutcomeDigest"].includes(
            key,
          ),
      )
    )
      throw new AppError("UNKNOWN_FIELD", "study export 请求包含未定义字段", 400);
    if (!body.studyFreezeId || !["study_source", "study_final"].includes(body.kind))
      throw new AppError("INVALID_INPUT", "studyFreezeId/kind 无效", 422);
    return NextResponse.json(createStudyExport(body), { status: 202 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
