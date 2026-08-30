import HomeClient from "../home-client";
import { requirePageRole } from "@/lib/access-control";

export default async function ScansPage() {
  await requirePageRole("admin", "/scans");
  return <HomeClient view="active" />;
}
