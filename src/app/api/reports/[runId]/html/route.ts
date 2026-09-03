import { NextResponse } from "next/server";
import { migrate } from "@/lib/db";
import { buildRunReportDto } from "@/lib/report";
import { renderLanguageControl, renderRunReportHtml, type ReportLocale } from "@/lib/report-html";
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
    const html = (await renderRunReportHtml(buildRunReportDto(runId), locale)).replace(
      "<body>",
      `<body>${renderLanguageControl(locale, new URL(request.url).pathname)}`,
    );
    return new NextResponse(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="accesscheck-${runId}.html"`,
      },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
