import crypto from "node:crypto";
import { migrate } from "../lib/db";
import { processNextAiItem } from "../lib/ai-overlay";

const workerId = `ai-worker-${process.pid}-${crypto.randomUUID()}`;
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  migrate();
  while (!stopping) {
    const processed = await processNextAiItem(workerId);
    if (!processed) await wait(1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
