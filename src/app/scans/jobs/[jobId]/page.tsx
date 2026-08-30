import { requirePageRole } from "@/lib/access-control";
import JobClient from "./job-client";

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  await requirePageRole("admin", `/scans/jobs/${jobId}`);
  return <JobClient jobId={jobId} />;
}
