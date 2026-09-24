type AiWorkerSlotOptions = {
  workerId: string;
  slot: number;
  isStopping: () => boolean;
  processNext: (workerId: string, slot: number) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
};

export async function consumeAiWorkerSlot({
  workerId,
  slot,
  isStopping,
  processNext,
  wait,
}: AiWorkerSlotOptions) {
  while (!isStopping()) {
    try {
      const processed = await processNext(workerId, slot);
      if (!processed) await wait(1_000);
    } catch {
      console.error("AI worker slot failed; retrying");
      await wait(1_000);
    }
  }
}

export async function runAiWorkerPool({
  workerId,
  slots,
  isStopping,
  processNext,
  wait,
}: Omit<AiWorkerSlotOptions, "slot"> & { slots: number }) {
  await Promise.allSettled(
    Array.from({ length: slots }, (_, index) =>
      consumeAiWorkerSlot({
        workerId,
        slot: index + 1,
        isStopping,
        processNext,
        wait,
      }),
    ),
  );
}
