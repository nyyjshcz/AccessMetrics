import { createAccessSession } from "../src/lib/access-control";

type MonitorResponse = {
  workerStatus: { onlineWorkers: number };
  activeCalls: Array<{ status: string }>;
  batches: Array<{ status: string; itemCounts: { completed: number } }>;
  usageSummary: {
    attempts: number;
    totalTokens: number | null;
    providerReportedCost: Array<{ currency: string; amount: number }>;
  };
};

async function main() {
  const session = createAccessSession({ role: "admin", source: "admin" });
  const deadline = Date.now() + 30_000;
  let monitor: MonitorResponse | null = null;
  while (Date.now() < deadline) {
    const response = await fetch("http://127.0.0.1:3000/api/ai/worker", {
      headers: { cookie: `accesscheck_session=${session}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`AI monitor returned HTTP ${response.status}`);
    monitor = (await response.json()) as MonitorResponse;
    if (monitor.batches[0]?.status === "completed" && monitor.workerStatus.onlineWorkers > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (!monitor?.batches[0]) throw new Error("AI Worker smoke data did not appear before timeout");

  if (monitor.workerStatus.onlineWorkers < 1)
    throw new Error("AI Worker heartbeat was not visible");
  if (monitor.activeCalls.length !== 0) throw new Error("The fake-provider request did not settle");
  if (monitor.batches[0]?.status !== "completed" || monitor.batches[0].itemCounts.completed !== 1)
    throw new Error("The fake-provider batch did not complete its single synthetic item");
  if (monitor.usageSummary.attempts !== 1 || monitor.usageSummary.totalTokens !== 25)
    throw new Error("Provider-reported token usage was not visible");
  if (
    monitor.usageSummary.providerReportedCost.length !== 1 ||
    monitor.usageSummary.providerReportedCost[0].currency !== "USD" ||
    monitor.usageSummary.providerReportedCost[0].amount !== 0.0012
  )
    throw new Error("Provider-reported fake cost was not visible");

  console.log(
    JSON.stringify({
      onlineWorkers: monitor.workerStatus.onlineWorkers,
      activeCalls: monitor.activeCalls.length,
      completedBatches: monitor.batches.filter((batch) => batch.status === "completed").length,
      attempts: monitor.usageSummary.attempts,
      totalTokens: monitor.usageSummary.totalTokens,
      providerReportedCost: monitor.usageSummary.providerReportedCost,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "AI Worker smoke verification failed");
  process.exitCode = 1;
});
