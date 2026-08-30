import { requirePageRole } from "@/lib/access-control";
import RunClient from "./run-client";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await requirePageRole("admin", `/scans/${runId}`);
  return <RunClient runId={runId} />;
}
