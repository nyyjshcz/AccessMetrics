import crypto from "node:crypto";
import { migrate } from "../lib/db";
import { processNextAiItem } from "../lib/ai-overlay";

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
  await Promise.all(Array.from({ length: MAX_WORKER_SLOTS }, (_, slot) => consume(slot + 1)));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
