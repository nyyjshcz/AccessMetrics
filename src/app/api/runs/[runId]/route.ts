import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { buildRunScore, serializeRunScore } from "@/lib/run-score";
import { AppError, errorEnvelope } from "@/lib/errors";
import { catalogEntryWithTags } from "@/lib/wcag";
import { summarizeAiRun } from "@/lib/ai-overlay";
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await currentSession();
    const { runId } = await context.params;
    const run = getDb()
      .prepare(
        "SELECT r.*,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
      )
      .get(runId) as any;
    if (!run) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    if (!session && !run.published) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    const score = buildRunScore(runId);
    const ai = summarizeAiRun(runId);
    const aiScore = ai.overlay.size
      ? serializeRunScore(buildRunScore(runId, { aiOverlay: ai.overlay }))
      : null;
    const severityCounts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    const principleCounts = { perceivable: 0, operable: 0, understandable: 0, robust: 0 };
    const resultRows = getDb()
      .prepare(
        "SELECT result_type,impact,rule_id,tags_json,node_count FROM rule_results WHERE run_id=? AND result_type IN ('violation','incomplete') ORDER BY id",
      )
      .all(runId) as Array<{
      result_type: string;
      impact: string | null;
      rule_id: string;
      tags_json: string;
      node_count: number;
    }>;
    for (const row of resultRows) {
      const count = Math.max(0, Number(row.node_count) || 0);
      if (row.result_type === "violation" && row.impact && row.impact in severityCounts)
        severityCounts[row.impact as keyof typeof severityCounts] += count;
      const entry = catalogEntryWithTags(row.rule_id, JSON.parse(row.tags_json ?? "[]"));
      for (const principle of entry.principles) {
        if (principle in principleCounts)
          principleCounts[principle as keyof typeof principleCounts] += count;
      }
    }
    const pages = getDb()
      .prepare(
        "SELECT id,canonical_url,scan_status,http_status,error_code,frame_coverage_status,frame_error_count FROM pages WHERE run_id=? ORDER BY canonical_url,id",
      )
      .all(runId) as Array<{
      id: string;
      canonical_url: string;
      scan_status: string;
      http_status: number | null;
      error_code: string | null;
      frame_coverage_status: string | null;
      frame_error_count: number;
    }>;
    const pageStatus = Object.fromEntries(
      Object.entries(
        pages.reduce<Record<string, number>>((counts, page) => {
          counts[page.scan_status] = (counts[page.scan_status] ?? 0) + 1;
          return counts;
        }, {}),
      ).sort(([left], [right]) => left.localeCompare(right)),
    );
    return NextResponse.json({
      run,
      score: serializeRunScore(score),
      ai: {
        ...ai,
        overlay: undefined,
      },
      aiScore,
      pages,
      pageStatus,
      severityCounts,
      principleCounts,
      coverage: {
        limitedPages: pages.filter((page) => page.frame_coverage_status === "coverage_limited")
          .length,
        frameErrors: pages.reduce((total, page) => total + Number(page.frame_error_count ?? 0), 0),
      },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
