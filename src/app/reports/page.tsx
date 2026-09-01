import HomeClient from "../home-client";
import { requirePageRole } from "@/lib/access-control";
import { getLocale } from "@/lib/i18n-server";

export default async function ReportsPage() {
  const role = await requirePageRole("visitor", "/reports");
  return (
    <HomeClient view="published" canManagePublished={role === "admin"} locale={await getLocale()} />
  );
}
