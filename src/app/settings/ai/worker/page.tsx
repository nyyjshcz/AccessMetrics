import Link from "next/link";
import { requirePageRole } from "@/lib/access-control";
import { getLocale, getMessages } from "@/lib/i18n-server";
import AiWorkerMonitorClient from "./worker-monitor-client";

export default async function AiWorkerMonitorPage() {
  await requirePageRole("admin", "/settings/ai/worker");
  const locale = await getLocale();
  const copy = getMessages(locale).ai;
  return (
    <div className="ai-worker-page">
      <header className="card ai-worker-header">
        <div>
          <p className="eyebrow">AI WORKER · READ ONLY</p>
          <h1>{copy.workerMonitor}</h1>
          <p className="settings-lede">{copy.workerMonitorLede}</p>
        </div>
        <div className="ai-worker-heading-actions">
          <span className="ai-worker-refresh-note">{copy.liveRefresh}</span>
          <Link className="secondary-link" href="/settings/ai">
            {copy.backToAiSettings}
          </Link>
        </div>
      </header>
      <AiWorkerMonitorClient locale={locale} />
    </div>
  );
}
