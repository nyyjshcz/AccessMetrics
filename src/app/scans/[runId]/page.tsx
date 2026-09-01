import { requirePageRole } from "@/lib/access-control";
import { getLocale } from "@/lib/i18n-server";
import RunClient from "./run-client";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requirePageRole("admin", `/scans/${runId}`);
  return <RunClient runId={runId} locale={await getLocale()} />;
}
