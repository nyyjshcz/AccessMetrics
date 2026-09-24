import crypto from "node:crypto";
import { migrate } from "../lib/db";
import { processNextAiItem, startAiWorkerHeartbeat } from "../lib/ai-overlay";

const workerPrefix = `ai-worker-${process.pid}-${crypto.randomUUID()}`;
const MAX_WORKER_SLOTS = 16;
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function consume(slot: number) {
  const workerId = `${workerPrefix}-${slot}`;
  while (!stopping) {
    const processed = await processNextAiItem(workerId);
    if (!processed) await wait(1000);
  }
}

async function main() {
  migrate();
  const workerIds = Array.from(
    { length: MAX_WORKER_SLOTS },
    (_, slot) => `${workerPrefix}-${slot + 1}`,
  );
  const heartbeat = startAiWorkerHeartbeat(workerIds);
  try {
    await Promise.all(workerIds.map((_, index) => consume(index + 1)));
  } finally {
    heartbeat.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
