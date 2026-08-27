import { NextResponse } from "next/server";
import { migrate } from "@/lib/db";
import { getDb } from "@/lib/db";
import { buildRunReportDto, renderRunReportHtml } from "@/lib/report";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const { runId } = await context.params;
    const run = getDb().prepare("SELECT published FROM scan_runs WHERE id=?").get(runId) as
      | { published: number }
      | undefined;
    if (!run || run.published !== 1) throw new AppError("NOT_FOUND", "报告不存在", 404);
    const html = renderRunReportHtml(buildRunReportDto(runId));
    return new NextResponse(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="accesscheck-${runId}.html"`,
      },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
