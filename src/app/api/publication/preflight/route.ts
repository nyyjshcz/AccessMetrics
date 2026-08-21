import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { scanPublicationDirectory } from "@/lib/privacy";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF", "缺少或无效的 CSRF token", 403);
    const body = await request.json();
    if (typeof body.path !== "string" || typeof body.exportId !== "string")
      throw new AppError("INVALID_INPUT", "path/exportId 必填", 422);
    return NextResponse.json(scanPublicationDirectory(body.path, body.exportId));
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
