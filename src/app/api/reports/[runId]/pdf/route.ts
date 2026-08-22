import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "@/lib/browser";
import { currentSession, requireRole } from "@/lib/auth";
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
    const session = await currentSession();
    if (!run || (!run.published && !session)) throw new AppError("NOT_FOUND", "报告不存在", 404);
    if (!run.published) await requireRole("admin", "computer_reviewer", "math_reviewer");
    const html = renderRunReportHtml(buildRunReportDto(runId));
    const browser = await chromium.launch(chromiumLaunchOptions());
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });
      const bytes = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center;color:#526173">AccessCheck Lishui · 自动检查报告</div>',
        footerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center;color:#526173">第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</div>',
        margin: { top: "36px", bottom: "36px", left: "20px", right: "20px" },
      });
      return new NextResponse(bytes as unknown as BodyInit, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="accesscheck-${runId}.pdf"`,
        },
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
