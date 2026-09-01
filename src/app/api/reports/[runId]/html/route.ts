import { NextResponse } from "next/server";
import { migrate } from "@/lib/db";
import { getDb } from "@/lib/db";
import { buildRunReportDto, renderRunReportHtml } from "@/lib/report";
import { AppError, errorEnvelope } from "@/lib/errors";
import { requireRequestRole } from "@/lib/access-control";
import type { ReportLocale } from "@/lib/report";
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
    requireRequestRole(request, "visitor");
    migrate();
    const { runId } = await context.params;
    const run = getDb().prepare("SELECT published FROM scan_runs WHERE id=?").get(runId) as
      | { published: number }
      | undefined;
    if (!run || run.published !== 1) throw new AppError("NOT_FOUND", "报告不存在", 404);
    const locale = reportLocale(request);
    const html = renderRunReportHtml(buildRunReportDto(runId), locale).replace(
      "<body>",
      `<body><form method="post" action="/api/preferences/locale" style="position:fixed;top:12px;right:18px;z-index:10"><input type="hidden" name="returnTo" value="${new URL(request.url).pathname}"/><input type="hidden" name="locale" value="${locale === "en" ? "zh-CN" : "en"}"/><button type="submit" style="padding:6px 10px;border:1px solid #d7e2ec;border-radius:6px;background:#fff;color:#102a43;cursor:pointer">${locale === "en" ? "中文" : "English"}</button></form>`,
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
