import { requirePageRole } from "@/lib/access-control";
import { getLocale } from "@/lib/i18n-server";
import ReviewClient from "./review-client";

export default async function ReviewPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requirePageRole("admin", `/scans/${runId}/review`);
  return <ReviewClient runId={runId} locale={await getLocale()} />;
}
