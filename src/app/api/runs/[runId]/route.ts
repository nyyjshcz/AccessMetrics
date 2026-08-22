import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { buildRunScore, serializeRunScore } from "@/lib/run-score";
import { AppError, errorEnvelope } from "@/lib/errors";
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
      pages,
      pageStatus,
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
