import { NextResponse } from "next/server";
import { aiImpactForResolvedIncomplete } from "@/lib/ai-overlay";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { hasActiveAiBatch, isRunPublished, RESOLUTION_VERDICTS } from "@/lib/incomplete-resolution";

export const dynamic = "force-dynamic";

function parseJson(value: string | null, fallback: unknown) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const { runId } = await context.params;
    const run = getDb().prepare("SELECT id FROM scan_runs WHERE id=?").get(runId);
    if (!run) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "20")));
    if (!Number.isInteger(page) || !Number.isInteger(pageSize))
      throw new AppError("INVALID_PAGINATION", "分页参数无效", 422);
    const total = Number(
      (getDb()
        .prepare(
          "SELECT COUNT(*) count FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id WHERE rr.run_id=? AND rr.result_type='incomplete'",
        )
        .get(runId) as { count: number }).count,
    );
    const rows = getDb()
      .prepare(
        `SELECT n.id,n.ordinal,n.target_json,n.html_sanitized,n.failure_summary,n.any_json,n.all_json,n.none_json,
                n.effective_impact,n.ai_evidence_json,n.ai_evidence_hash,n.ai_evidence_version,
                rr.id rule_result_id,rr.rule_id,rr.impact rule_impact,rr.description,rr.help,rr.help_url,
                rr.wcag_criteria_json,rr.principles_json,rr.scoring_eligible,
                p.id page_id,p.canonical_url,p.title,
                mr.verdict manual_verdict,mr.note manual_note,mr.reviewed_at manual_reviewed_at,
                ai.verdict ai_verdict,ai.reason ai_reason,ai.completed_at ai_completed_at
           FROM result_nodes n
           JOIN rule_results rr ON rr.id=n.rule_result_id
           JOIN pages p ON p.id=rr.page_id
           LEFT JOIN manual_reviews mr ON mr.result_node_id=n.id AND mr.sample_id IS NULL
             AND mr.review_context='ad_hoc' AND mr.reviewer='local' AND mr.is_current=1
           LEFT JOIN ai_review_items ai ON ai.id=(
             SELECT i.id FROM ai_review_items i
             JOIN ai_review_batches b ON b.id=i.batch_id
             WHERE i.result_node_id=n.id AND i.status='completed' AND i.verdict IS NOT NULL
               AND b.run_id=? AND b.page_id IS NULL AND b.study_freeze_id IS NULL
             ORDER BY i.completed_at DESC,i.id DESC LIMIT 1
           )
          WHERE rr.run_id=? AND rr.result_type='incomplete'
          ORDER BY p.canonical_url,rr.rule_id,n.ordinal,n.id
          LIMIT ? OFFSET ?`,
      )
      .all(runId, runId, pageSize, (page - 1) * pageSize) as any[];
    const items = rows.map((row) => {
      const manualVerdict = RESOLUTION_VERDICTS.includes(row.manual_verdict)
        ? row.manual_verdict
        : null;
      const aiVerdict = RESOLUTION_VERDICTS.includes(row.ai_verdict) ? row.ai_verdict : null;
      const verdict = manualVerdict ?? aiVerdict ?? null;
      const source = manualVerdict ? "manual" : aiVerdict ? "ai" : "raw";
      return {
        id: row.id,
        ordinal: row.ordinal,
        page: { id: row.page_id, url: row.canonical_url, title: row.title },
        rule: {
          id: row.rule_id,
          description: row.description,
          help: row.help,
          helpUrl: row.help_url,
          wcag: parseJson(row.wcag_criteria_json, []),
          principles: parseJson(row.principles_json, []),
          scoringEligible: Number(row.scoring_eligible) === 1,
        },
        target: parseJson(row.target_json, [row.target_json]),
        html: row.html_sanitized,
        failureSummary: row.failure_summary,
        checks: {
          any: parseJson(row.any_json, []),
          all: parseJson(row.all_json, []),
          none: parseJson(row.none_json, []),
        },
        evidence: parseJson(row.ai_evidence_json, null),
        evidenceHash: row.ai_evidence_hash,
        evidenceVersion: row.ai_evidence_version,
        resolution: {
          verdict,
          source,
          manual: manualVerdict
            ? { verdict: manualVerdict, note: row.manual_note, reviewedAt: row.manual_reviewed_at }
            : null,
          ai: aiVerdict
            ? { verdict: aiVerdict, reason: row.ai_reason, completedAt: row.ai_completed_at }
            : null,
          scoringImpact:
            verdict && verdict !== "uncertain" && Number(row.scoring_eligible) === 1
              ? aiImpactForResolvedIncomplete(row, { impact: row.rule_impact })
              : null,
        },
      };
    });
    return NextResponse.json({
      items,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      manualLocked: Boolean(hasActiveAiBatch(runId)),
      readOnly: isRunPublished(runId),
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
