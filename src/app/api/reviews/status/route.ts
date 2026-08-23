import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function GET(request: Request) {
  try {
    migrate();
    const session = await requireRole("admin", "computer_reviewer", "math_reviewer");
    const runId = new URL(request.url).searchParams.get("runId");
    if (!runId) throw new AppError("INVALID_INPUT", "runId 必填", 422);
    const rows = getDb()
      .prepare(
        "SELECT reviewer,COUNT(*) count FROM manual_reviews mr JOIN result_nodes n ON n.id=mr.result_node_id JOIN rule_results rr ON rr.id=n.rule_result_id JOIN scan_runs r ON r.id=rr.run_id WHERE r.id=? AND mr.review_context='ad_hoc' AND mr.is_current=1 AND (mr.reviewer=? OR ?='admin') GROUP BY reviewer",
      )
      .all(
        runId,
        session.user.role === "computer_reviewer"
          ? "computer_lead"
          : session.user.role === "math_reviewer"
            ? "math_lead"
            : "admin",
        session.user.role,
      );
    return NextResponse.json({ counts: rows });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
