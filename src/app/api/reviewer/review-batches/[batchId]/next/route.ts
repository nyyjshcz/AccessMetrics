import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

export async function GET(request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    migrate();
    const session = await requireRole("computer_reviewer", "math_reviewer");
    const { batchId } = await context.params;
    const reviewer = session.user.role === "computer_reviewer" ? "computer_lead" : "math_lead";
    const sample = getDb()
      .prepare(
        "SELECT s.*,n.html_sanitized,n.target_json,rr.rule_id,rr.description,rr.help,rr.help_url FROM manual_review_samples s JOIN result_nodes n ON n.id=s.result_node_id JOIN rule_results rr ON rr.id=n.rule_result_id WHERE s.batch_id=? AND NOT EXISTS (SELECT 1 FROM manual_reviews r WHERE r.sample_id=s.id AND r.reviewer=? AND r.is_current=1) ORDER BY s.draw_order LIMIT 1",
      )
      .get(batchId, reviewer);
    if (!sample) return NextResponse.json({ done: true, sample: null });
    return NextResponse.json({ done: false, sample });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
