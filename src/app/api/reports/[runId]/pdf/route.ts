import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { chromiumLaunchOptions } from "@/lib/browser";
import { migrate } from "@/lib/db";
import { buildRunReportDto } from "@/lib/report";
import { renderRunReportHtml, type ReportLocale } from "@/lib/report-html";
import { AppError, errorEnvelope } from "@/lib/errors";
import { requireReportExportAccess } from "@/lib/report-access";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n-server";

function reportLocale(request: Request): ReportLocale {
  const query = new URL(request.url).searchParams.get("lang");
  const cookie = request.headers
    .get("cookie")
    ?.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=(zh-CN|en)(?:;|$)`))?.[1];
  return resolveLocale(query, cookie);
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const { runId } = await context.params;
    requireReportExportAccess(request, runId);
    const locale = reportLocale(request);
    const html = await renderRunReportHtml(buildRunReportDto(runId), locale);
    // This route prints self-contained HTML via setContent and never navigates
    // to an external URL, so Web does not need the scan worker's proxy.
    const browser = await chromium.launch(chromiumLaunchOptions({ requireProxy: false }));
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
        headerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#526173">AccessCheck Lishui · ${locale === "en" ? "Automated accessibility report" : "自动检查报告"}</div>`,
        footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#526173">${locale === "en" ? "Page" : "第"} <span class="pageNumber"></span> / <span class="totalPages"></span> ${locale === "en" ? "" : "页"}</div>`,
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
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
