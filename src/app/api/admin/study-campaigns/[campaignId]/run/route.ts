import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { startCampaignRun } from "@/lib/study";

export async function POST(request: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const { campaignId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "campaign run 请求必须是对象", 422);
    if (Object.keys(body).some((key) => key !== "expectedCampaignPlanHash"))
      throw new AppError("UNKNOWN_FIELD", "campaign run 请求包含未定义字段", 400);
    if (typeof body.expectedCampaignPlanHash !== "string" || !body.expectedCampaignPlanHash)
      throw new AppError("INVALID_INPUT", "expectedCampaignPlanHash 必填", 422);
    const campaign = getDb()
      .prepare("SELECT campaign_plan_hash FROM study_campaigns WHERE id=?")
      .get(campaignId) as { campaign_plan_hash: string } | undefined;
    if (!campaign) throw new AppError("NOT_FOUND", "campaign 不存在", 404);
    if (body.expectedCampaignPlanHash !== campaign.campaign_plan_hash)
      throw new AppError("CAMPAIGN_HASH_MISMATCH", "campaign plan hash 不匹配", 409);
    const result = startCampaignRun(campaignId, session.user.id);
    return NextResponse.json(result, { status: result.jobId ? 202 : 200 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
