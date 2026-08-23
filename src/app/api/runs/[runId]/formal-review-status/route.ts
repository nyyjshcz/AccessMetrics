import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { deriveFormalReviewStatus } from "@/lib/formal-review-status";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await requireRole("admin", "computer_reviewer", "math_reviewer");
    const { runId } = await context.params;
    const run = getDb().prepare("SELECT id FROM scan_runs WHERE id=?").get(runId) as
      | { id: string }
      | undefined;
    if (!run) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    const reviewer =
      session.user.role === "computer_reviewer"
        ? "computer_lead"
        : session.user.role === "math_reviewer"
          ? "math_lead"
          : null;
    const campaign = getDb()
      .prepare(
        `WITH matching_campaigns AS (
           SELECT campaign_id,1 AS run_linked
             FROM study_run_attempts
            WHERE run_id=?
           UNION ALL
           SELECT cs.campaign_id,0 AS run_linked
             FROM study_campaign_sites cs
             JOIN scan_runs sr ON sr.site_id=cs.site_id
            WHERE sr.id=?
         )
         SELECT c.id,c.status,MAX(m.run_linked) AS run_linked
           FROM matching_campaigns m
           JOIN study_campaigns c ON c.id=m.campaign_id
          GROUP BY c.id,c.status,c.created_at
          ORDER BY MAX(m.run_linked) DESC,c.created_at DESC
          LIMIT 1`,
      )
      .get(runId, runId) as { id: string; status: string; run_linked: number } | undefined;
    const r1ApprovalCount = campaign
      ? Number(
          (
            getDb()
              .prepare(
                "SELECT COUNT(DISTINCT role) AS count FROM human_gate_evidence WHERE gate_id='R1' AND campaign_id=? AND decision='approved' AND is_current=1",
              )
              .get(campaign.id) as { count: number | null }
          ).count ?? 0,
        )
      : 0;
    const pipeline = campaign
      ? (getDb()
          .prepare(
            `SELECT sf.id AS freeze_id,sf.status AS freeze_status,
                    source.id AS source_export_id,source.status AS source_export_status,
                    batch.id AS batch_id,batch.status AS batch_status,
                    review_freeze.status AS review_freeze_status
               FROM study_freezes sf
               LEFT JOIN study_exports source
                 ON source.study_freeze_id=sf.id
                AND source.kind='study_source'
                AND source.is_current=1
               LEFT JOIN manual_review_batches batch
                 ON batch.study_freeze_id=sf.id
                AND (source.id IS NULL OR batch.source_export_id=source.id)
               LEFT JOIN review_freezes review_freeze
                 ON review_freeze.study_freeze_id=sf.id
                AND review_freeze.is_current=1
              WHERE sf.campaign_id=?
              ORDER BY batch.created_at DESC,source.revision DESC
              LIMIT 1`,
          )
          .get(campaign.id) as
          | {
              freeze_id: string;
              freeze_status: string;
              source_export_id: string | null;
              source_export_status: string | null;
              batch_id: string | null;
              batch_status: string | null;
              review_freeze_status: string | null;
            }
          | undefined)
      : undefined;
    const myProgress =
      pipeline?.batch_id && reviewer
        ? (getDb()
            .prepare(
              `SELECT COUNT(*) total,
                    SUM(CASE WHEN EXISTS (
                      SELECT 1 FROM manual_reviews mr
                       WHERE mr.sample_id=s.id
                         AND mr.review_context='formal'
                         AND mr.reviewer=?
                         AND mr.is_current=1
                    ) THEN 1 ELSE 0 END) completed
               FROM manual_review_samples s
              WHERE s.batch_id=?`,
            )
            .get(reviewer, pipeline.batch_id) as { total: number | null; completed: number | null })
        : null;
    const status = deriveFormalReviewStatus({
      campaignId: campaign?.id ?? null,
      campaignStatus: campaign?.status ?? null,
      r1ApprovalCount,
      freezeStatus: pipeline?.freeze_status ?? null,
      sourceExportStatus: pipeline?.source_export_status ?? null,
      batchId: pipeline?.batch_id ?? null,
      batchStatus: pipeline?.batch_status ?? null,
      reviewFreezeStatus: pipeline?.review_freeze_status ?? null,
      reviewer,
      completedByMe: Number(myProgress?.completed ?? 0),
      totalForMe: Number(myProgress?.total ?? 0),
    });
    return NextResponse.json({
      ...status,
      reviewPath:
        status.reviewAvailable && reviewer && pipeline?.batch_id
          ? `/admin/reviews/${pipeline.batch_id}`
          : null,
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
