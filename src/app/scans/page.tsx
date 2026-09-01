import HomeClient from "../home-client";
import { requirePageRole } from "@/lib/access-control";
import { getLocale } from "@/lib/i18n-server";

export default async function ScansPage() {
  await requirePageRole("admin", "/scans");
  return <HomeClient view="active" locale={await getLocale()} />;
}
