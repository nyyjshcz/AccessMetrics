import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function GET(_request: Request, context: { params: Promise<{ campaignId: string }> }) {
  try {
    migrate();
    await requireRole("admin", "computer_reviewer", "math_reviewer");
    const { campaignId } = await context.params;
    const campaign = getDb().prepare("SELECT * FROM study_campaigns WHERE id=?").get(campaignId);
    if (!campaign) throw new AppError("NOT_FOUND", "campaign 不存在", 404);
    const slots = getDb()
      .prepare(
        "SELECT * FROM study_campaign_sites WHERE campaign_id=? ORDER BY slot,replacement_rank",
      )
      .all(campaignId);
    const attempts = getDb()
      .prepare("SELECT * FROM study_run_attempts WHERE campaign_id=? ORDER BY slot,attempt_no")
      .all(campaignId);
    return NextResponse.json({ campaign, slots, attempts });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
