import { requirePageRole } from "@/lib/access-control";
import AiSettingsClient from "./ai-settings-client";

export default async function AiSettingsPage() {
  await requirePageRole("admin", "/settings/ai");
  return <AiSettingsClient />;
}
