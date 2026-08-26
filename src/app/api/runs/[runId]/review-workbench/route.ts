import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { getRuleLocalization } from "@/lib/localization";
import {
  buildReviewWorkbench,
  type ReviewVerdict,
  type ReviewWorkbenchInput,
} from "@/lib/review-workbench";

const parseJson = (value: string | null, fallback: unknown) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await currentSession();
    if (!session) throw new AppError("UNAUTHORIZED", "请先登录后查看人工审核工作台", 401);
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
          : "";
    const rows = getDb()
      .prepare(
        `SELECT rr.id finding_id,rr.result_type,rr.impact,rr.rule_id,rr.description,rr.help,rr.help_url,
                n.id result_node_id,n.ordinal,n.target_json,n.html_sanitized,n.failure_summary,
                n.frame_path_json,n.frame_url,n.frame_origin_relation,n.target_hash,n.effective_impact,
                p.id page_id,p.canonical_url page_url,p.title page_title,
                (SELECT COUNT(*) FROM manual_reviews mr
                  WHERE mr.result_node_id=n.id AND mr.review_context='ad_hoc' AND mr.is_current=1) any_reviewer_count,
                (SELECT mr.id FROM manual_reviews mr
                  WHERE mr.result_node_id=n.id AND mr.review_context='ad_hoc' AND mr.reviewer=? AND mr.is_current=1
                  ORDER BY mr.revision DESC LIMIT 1) current_review_id,
                (SELECT mr.verdict FROM manual_reviews mr
                  WHERE mr.result_node_id=n.id AND mr.review_context='ad_hoc' AND mr.reviewer=? AND mr.is_current=1
                  ORDER BY mr.revision DESC LIMIT 1) current_review_verdict,
                (SELECT mr.note FROM manual_reviews mr
                  WHERE mr.result_node_id=n.id AND mr.review_context='ad_hoc' AND mr.reviewer=? AND mr.is_current=1
                  ORDER BY mr.revision DESC LIMIT 1) current_review_note,
                (SELECT mr.revision FROM manual_reviews mr
                  WHERE mr.result_node_id=n.id AND mr.review_context='ad_hoc' AND mr.reviewer=? AND mr.is_current=1
                  ORDER BY mr.revision DESC LIMIT 1) current_review_revision,
                (SELECT mr.reviewed_at FROM manual_reviews mr
                  WHERE mr.result_node_id=n.id AND mr.review_context='ad_hoc' AND mr.reviewer=? AND mr.is_current=1
                  ORDER BY mr.revision DESC LIMIT 1) current_reviewed_at
           FROM rule_results rr
           JOIN result_nodes n ON n.rule_result_id=rr.id
           JOIN pages p ON p.id=rr.page_id
          WHERE rr.run_id=? AND rr.result_type='incomplete'
          ORDER BY rr.id,n.ordinal`,
      )
      .all(reviewer, reviewer, reviewer, reviewer, reviewer, runId) as any[];
    const inputs: ReviewWorkbenchInput[] = rows.map((row) => ({
      findingId: String(row.finding_id),
      resultNodeId: String(row.result_node_id),
      resultType: "incomplete",
      impact: row.impact ? String(row.impact) : null,
      ruleId: String(row.rule_id),
      description: String(row.description),
      help: String(row.help),
      helpUrl: String(row.help_url),
      pageId: String(row.page_id),
      pageUrl: String(row.page_url),
      pageTitle: row.page_title ? String(row.page_title) : null,
      ordinal: Number(row.ordinal),
      target: parseJson(row.target_json, [String(row.target_json ?? "")]),
      html: String(row.html_sanitized ?? ""),
      failureSummary: row.failure_summary ? String(row.failure_summary) : null,
      framePath: parseJson(row.frame_path_json, []),
      frameUrl: row.frame_url ? String(row.frame_url) : null,
      frameOriginRelation: row.frame_origin_relation ? String(row.frame_origin_relation) : null,
      targetHash: row.target_hash ? String(row.target_hash) : null,
      effectiveImpact: row.effective_impact ? String(row.effective_impact) : null,
      currentReview: row.current_review_id
        ? {
            id: String(row.current_review_id),
            verdict: row.current_review_verdict as ReviewVerdict,
            note: String(row.current_review_note ?? ""),
            revision: Number(row.current_review_revision),
            reviewedAt: String(row.current_reviewed_at),
          }
        : null,
      anyReviewerCount: Number(row.any_reviewer_count ?? 0),
    }));
    const workbench = buildReviewWorkbench(inputs);
    const requestedNodeId = new URL(request.url).searchParams.get("nodeId");
    const requestedInput = requestedNodeId
      ? inputs.find((item) => item.resultNodeId === requestedNodeId)
      : undefined;
    if (requestedNodeId && !requestedInput)
      throw new AppError("NOT_FOUND", "该节点不属于当前扫描，或不需要人工审核", 404);
    const requestedFinding = requestedInput
      ? workbench.findings.find((finding) => finding.id === requestedInput.findingId)
      : undefined;
    const localizations = Object.fromEntries(
      [...new Set(workbench.findings.map((finding) => finding.ruleId))].map((ruleId) => [
        ruleId,
        getRuleLocalization(ruleId),
      ]),
    );
    return NextResponse.json({
      mode: "exploratory",
      canReview: Boolean(reviewer),
      role: session.user.role,
      localizations,
      ...workbench,
      manualSelection:
        requestedInput && requestedFinding ? { ...requestedFinding, node: requestedInput } : null,
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
