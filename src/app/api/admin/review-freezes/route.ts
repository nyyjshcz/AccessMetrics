import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { freezeManualReviews } from "@/lib/study";
import { AppError, errorEnvelope } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "review freeze 请求必须是对象", 422);
    if (Object.keys(body).some((key) => !["studyFreezeId", "batchId"].includes(key)))
      throw new AppError("UNKNOWN_FIELD", "review freeze 请求包含未定义字段", 400);
    if (typeof body.studyFreezeId !== "string" || typeof body.batchId !== "string")
      throw new AppError("INVALID_INPUT", "studyFreezeId/batchId 必须是字符串", 422);
    return NextResponse.json(freezeManualReviews(body.studyFreezeId, body.batchId), {
      status: 201,
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
