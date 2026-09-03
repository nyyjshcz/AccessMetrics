import { NextResponse } from "next/server";
import { migrate } from "@/lib/db";
import { buildRunReportDto } from "@/lib/report";
import { serializeRunScore } from "@/lib/run-score";
import { AppError, errorEnvelope } from "@/lib/errors";
import { requireReportExportAccess } from "@/lib/report-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const { runId } = await context.params;
    requireReportExportAccess(request, runId);
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
