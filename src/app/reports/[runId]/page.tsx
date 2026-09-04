import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/access-control";
import { getLocale } from "@/lib/i18n-server";
import { buildRunReportDto } from "@/lib/report";
import { reportGroupingStyles, reportStyles } from "@/lib/report-html";
import { getReportPageAccess } from "@/lib/report-access";
import { summarizeAiRun } from "@/lib/ai-overlay";
import { ReportDocument } from "@/components/report-document";
import ReportActions from "./report-actions";

export const dynamic = "force-dynamic";

export default async function FullReportPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const role = await requirePageRole("visitor", `/reports/${runId}`);
  const access = getReportPageAccess(runId, role);
  if (!access) notFound();
  const locale = await getLocale();
  const model = buildRunReportDto(runId);
  const ai = summarizeAiRun(runId);
  const aiActive = ai.batch?.status === "queued" || ai.batch?.status === "running";
  return (
    <div className="full-report-page">
      <style
        data-report-document-styles="true"
        dangerouslySetInnerHTML={{ __html: `${reportStyles()}${reportGroupingStyles()}` }}
      />
      <ReportDocument model={model} locale={locale} />
      {role === "admin" ? (
        <ReportActions
          runId={runId}
          published={access.published === 1}
          aiActive={aiActive}
          locale={locale}
        />
      ) : null}
    </div>
  );
}
