import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { createManualReviewBatch } from "@/lib/study";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "抽样请求必须是对象", 422);
    if (Object.keys(body).some((key) => !["studyFreezeId", "sourceExportId"].includes(key)))
      throw new AppError("UNKNOWN_FIELD", "抽样请求包含未定义字段", 400);
    if ("targetSize" in body)
      throw new AppError("UNKNOWN_FIELD", "targetSize 由服务端固定计算", 400);
    if (!body.studyFreezeId || !body.sourceExportId)
      throw new AppError("INVALID_INPUT", "studyFreezeId/sourceExportId 必填", 422);
    if ("seed" in body)
      throw new AppError("UNKNOWN_FIELD", "seed 由服务端根据 populationDigest 计算", 400);
    return NextResponse.json(createManualReviewBatch(body.studyFreezeId, body.sourceExportId), {
      status: 201,
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
