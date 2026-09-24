import crypto from "node:crypto";
import { migrate } from "../lib/db";
import { processNextAiItem, startAiWorkerHeartbeat } from "../lib/ai-overlay";
import { runAiWorkerPool } from "./ai-runtime";

const workerPrefix = `ai-worker-${process.pid}-${crypto.randomUUID()}`;
const MAX_WORKER_SLOTS = 16;
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

async function main() {
  migrate();
  const heartbeat = startAiWorkerHeartbeat(workerPrefix);
  try {
    await runAiWorkerPool({
      workerId: workerPrefix,
      slots: MAX_WORKER_SLOTS,
      isStopping: () => stopping,
      processNext: processNextAiItem,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  } finally {
    heartbeat.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
