import { NextResponse } from "next/server";
import { getDb, migrate } from "@/lib/db";
import { buildRunScore, serializeRunScore } from "@/lib/run-score";
import { AppError, errorEnvelope } from "@/lib/errors";
import { loadEffectiveOverlayForRun, summarizeAiRun } from "@/lib/ai-overlay";
import { requireRequestRole } from "@/lib/access-control";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    requireRequestRole(request, "admin");
    migrate();
    const { runId } = await context.params;
    const run = getDb()
      .prepare(
        "SELECT r.*,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
      )
      .get(runId) as any;
    if (!run) throw new AppError("NOT_FOUND", "扫描不存在", 404);

    const effectiveOverlay = loadEffectiveOverlayForRun(runId);
    const rawScore = buildRunScore(runId);
    const score = buildRunScore(runId, { aiOverlay: effectiveOverlay });
    const ai = summarizeAiRun(runId);
    const pages = getDb()
      .prepare(
        "SELECT id,canonical_url,title,scan_status,http_status,error_code,frame_coverage_status,frame_error_count FROM pages WHERE run_id=? ORDER BY canonical_url,id",
      )
      .all(runId) as any[];
    const pageStatus = pages.reduce<Record<string, number>>((counts, page) => {
      counts[page.scan_status] = (counts[page.scan_status] ?? 0) + 1;
      return counts;
    }, {});
    const severityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const row of getDb()
      .prepare("SELECT impact,node_count FROM rule_results WHERE run_id=? AND result_type='violation'")
      .all(runId) as Array<{ impact: string | null; node_count: number }>) {
      const impact = row.impact ?? "minor";
      if (impact in severityCounts)
        severityCounts[impact as keyof typeof severityCounts] += Math.max(0, Number(row.node_count) || 0);
    }

    return NextResponse.json({
      run,
      score: serializeRunScore(score),
      rawScore: serializeRunScore(rawScore),
      ai: { ...ai, aiOverlay: undefined, overlay: undefined },
      pages,
      pageStatus,
      severityCounts,
      coverage: {
        limitedPages: pages.filter((page) => page.frame_coverage_status === "coverage_limited").length,
        frameErrors: pages.reduce((total, page) => total + Number(page.frame_error_count ?? 0), 0),
      },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
