import { NextResponse } from "next/server";
import { getDb, migrate } from "@/lib/db";
import { buildRunReportDto } from "@/lib/report";
import { serializeRunScore } from "@/lib/run-score";
import { AppError, errorEnvelope } from "@/lib/errors";
import { requireRequestRole } from "@/lib/access-control";

export const dynamic = "force-dynamic";

/** Published reports are immutable and visible to either authorized role. */
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    requireRequestRole(request, "visitor");
    migrate();
    const { runId } = await context.params;
    const run = getDb().prepare("SELECT published FROM scan_runs WHERE id=?").get(runId) as
      | { published: number }
      | undefined;
    if (!run || run.published !== 1) throw new AppError("NOT_FOUND", "报告不存在", 404);
    const report = buildRunReportDto(runId);
    // exact score breakdowns use bigint values internally; serialize them
    // before NextResponse.json invokes JSON.stringify for the download.
    return NextResponse.json(
      {
        ...report,
        score: serializeRunScore(report.score),
        resolvedScore: serializeRunScore(report.resolvedScore),
      },
      {
        headers: {
          "content-disposition": `attachment; filename="accesscheck-${runId}.json"`,
        },
      },
    );
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
