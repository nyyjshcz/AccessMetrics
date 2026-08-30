import HomeClient from "../home-client";
import { requirePageRole } from "@/lib/access-control";

export default async function ReportsPage() {
  await requirePageRole("visitor", "/reports");
  return <HomeClient view="published" />;
}
