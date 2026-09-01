import { requirePageRole } from "@/lib/access-control";
import { getLocale } from "@/lib/i18n-server";
import AiSettingsClient from "./ai-settings-client";

export default async function AiSettingsPage() {
  await requirePageRole("admin", "/settings/ai");
  return <AiSettingsClient locale={await getLocale()} />;
}
