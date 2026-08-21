import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { migrate } from "@/lib/db";
import { createCampaign } from "@/lib/study";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "campaign 请求必须是对象", 422);
    const allowed = new Set([
      "campaignPlanVersion",
      "campaignPlanHash",
      "protocolHash",
      "sampleFrameHash",
      "baseline",
      "targetSiteCount",
      "pageLimit",
      "retryPolicy",
      "replacementPolicy",
      "allowedFailureReasonCodes",
      "slots",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "campaign 请求包含未定义字段或 runIds", 400);
    return NextResponse.json(createCampaign(body), { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
