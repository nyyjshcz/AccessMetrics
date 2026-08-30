import { requirePageRole } from "@/lib/access-control";
import NewScanClient from "./new-scan-client";

export default async function NewScanPage() {
  await requirePageRole("admin", "/scans/new");
  return <NewScanClient />;
}
