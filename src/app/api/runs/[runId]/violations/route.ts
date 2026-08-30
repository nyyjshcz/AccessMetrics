import { NextResponse } from "next/server";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { requireRequestRole } from "@/lib/access-control";

export const dynamic = "force-dynamic";

function json(value: string | null, fallback: unknown) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    requireRequestRole(request, "admin");
    migrate();
    const { runId } = await context.params;
    if (!getDb().prepare("SELECT id FROM scan_runs WHERE id=?").get(runId)) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    const rows = getDb().prepare(`
      SELECT n.id,n.ordinal,n.target_json,n.html_sanitized,n.failure_summary,n.any_json,n.all_json,n.none_json,
             rr.rule_id,rr.impact,rr.description,rr.help,rr.help_url,rr.wcag_criteria_json,
             p.canonical_url,p.title
      FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id
      JOIN pages p ON p.id=rr.page_id
      WHERE rr.run_id=? AND rr.result_type='violation'
      ORDER BY p.canonical_url,rr.rule_id,n.ordinal,n.id`).all(runId) as any[];
    return NextResponse.json({ items: rows.map((row) => ({
      id: row.id, ordinal: row.ordinal,
      page: { url: row.canonical_url, title: row.title },
      rule: { id: row.rule_id, impact: row.impact, description: row.description, help: row.help, helpUrl: row.help_url, wcag: json(row.wcag_criteria_json, []) },
      target: json(row.target_json, [row.target_json]), html: row.html_sanitized,
      failureSummary: row.failure_summary,
      checks: { any: json(row.any_json, []), all: json(row.all_json, []), none: json(row.none_json, []) },
    })), total: rows.length });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), { status: error instanceof AppError ? error.status : 500 });
  }
}
