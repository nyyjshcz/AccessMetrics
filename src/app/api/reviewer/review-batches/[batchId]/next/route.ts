import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { getRuleLocalization } from "@/lib/localization";

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    migrate();
    const session = await requireRole("computer_reviewer", "math_reviewer");
    const { batchId } = await context.params;
    const reviewer = session.user.role === "computer_reviewer" ? "computer_lead" : "math_lead";
    const batch = getDb()
      .prepare(
        "SELECT id,target_size,population_size,strata_config_json,status FROM manual_review_batches WHERE id=?",
      )
      .get(batchId) as
      | {
          id: string;
          target_size: number;
          population_size: number;
          strata_config_json: string;
          status: string;
        }
      | undefined;
    if (!batch) throw new AppError("NOT_FOUND", "正式抽样批次不存在", 404);
    const progress = getDb()
      .prepare(
        `SELECT COUNT(*) total,
                SUM(CASE WHEN EXISTS (SELECT 1 FROM manual_reviews r WHERE r.sample_id=s.id AND r.reviewer=? AND r.review_context='formal' AND r.is_current=1) THEN 1 ELSE 0 END) completed_by_me
           FROM manual_review_samples s WHERE s.batch_id=?`,
      )
      .get(reviewer, batchId) as {
      total: number;
      completed_by_me: number | null;
    };
    const sample = getDb()
      .prepare(
        "SELECT s.*,n.html_sanitized,n.target_json,n.failure_summary,n.frame_path_json,n.frame_url,n.frame_origin_relation,n.effective_impact,p.canonical_url page_url,p.title page_title,rr.rule_id,rr.description,rr.help,rr.help_url FROM manual_review_samples s JOIN result_nodes n ON n.id=s.result_node_id JOIN rule_results rr ON rr.id=n.rule_result_id JOIN pages p ON p.id=rr.page_id WHERE s.batch_id=? AND NOT EXISTS (SELECT 1 FROM manual_reviews r WHERE r.sample_id=s.id AND r.reviewer=? AND r.review_context='formal' AND r.is_current=1) ORDER BY s.draw_order LIMIT 1",
      )
      .get(batchId, reviewer) as any;
    const responseProgress = {
      total: Number(progress.total ?? 0),
      completedByMe: Number(progress.completed_by_me ?? 0),
      remainingForMe: Math.max(
        0,
        Number(progress.total ?? 0) - Number(progress.completed_by_me ?? 0),
      ),
    };
    if (!sample)
      return NextResponse.json({
        done: true,
        sample: null,
        batch: {
          targetSize: batch.target_size,
          populationSize: batch.population_size,
          quota: JSON.parse(batch.strata_config_json),
          status: batch.status,
        },
        progress: responseProgress,
      });
    const parsedTarget = (() => {
      try {
        return JSON.parse(sample.target_json);
      } catch {
        return [sample.target_json];
      }
    })();
    const parsedFramePath = (() => {
      try {
        return sample.frame_path_json ? JSON.parse(sample.frame_path_json) : [];
      } catch {
        return [];
      }
    })();
    return NextResponse.json({
      done: false,
      sample: {
        ...sample,
        target: parsedTarget,
        framePath: parsedFramePath,
        localization: getRuleLocalization(sample.rule_id),
      },
      batch: {
        targetSize: batch.target_size,
        populationSize: batch.population_size,
        quota: JSON.parse(batch.strata_config_json),
        status: batch.status,
      },
      progress: responseProgress,
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
