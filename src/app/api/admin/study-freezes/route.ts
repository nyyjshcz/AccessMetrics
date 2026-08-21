import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { freezeCampaign } from "@/lib/study";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "freeze 请求必须是对象", 422);
    if (Object.keys(body).some((key) => !["campaignId", "expectedCampaignPlanHash"].includes(key)))
      throw new AppError("UNKNOWN_FIELD", "freeze 请求包含未定义字段", 400);
    if (!body.campaignId || !body.expectedCampaignPlanHash)
      throw new AppError("INVALID_INPUT", "campaignId 和 expectedCampaignPlanHash 必填", 422);
    const campaign = getDb()
      .prepare("SELECT campaign_plan_hash FROM study_campaigns WHERE id=?")
      .get(body.campaignId) as any;
    if (!campaign || campaign.campaign_plan_hash !== body.expectedCampaignPlanHash)
      throw new AppError("CAMPAIGN_HASH_MISMATCH", "campaign plan hash 不匹配", 409);
    return NextResponse.json(freezeCampaign(body.campaignId), { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
