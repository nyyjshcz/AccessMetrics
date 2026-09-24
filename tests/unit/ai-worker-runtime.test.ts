import { describe, expect, it, vi } from "vitest";
import { consumeAiWorkerSlot, runAiWorkerPool } from "@/worker/ai-runtime";

describe("AI worker slot recovery", () => {
  it("retries a failed item without exposing the exception or stopping its caller", async () => {
    let stopping = false;
    let attempts = 0;
    const wait = vi.fn(async () => {});
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await consumeAiWorkerSlot({
        workerId: "process-worker",
        slot: 4,
        isStopping: () => stopping,
        wait,
        processNext: async (workerId, slot) => {
          expect(workerId).toBe("process-worker");
          expect(slot).toBe(4);
          attempts += 1;
          if (attempts === 1) throw new Error("sensitive provider response");
          stopping = true;
          return true;
        },
      });

      expect(attempts).toBe(2);
      expect(wait).toHaveBeenCalledTimes(1);
      expect(wait).toHaveBeenCalledWith(1_000);
      expect(log).toHaveBeenCalledWith("AI worker slot failed; retrying");
      expect(log.mock.calls.flat().join(" ")).not.toContain("sensitive provider response");
    } finally {
      log.mockRestore();
    }
  });

  it("waits for all active slots before allowing process shutdown after a slot error", async () => {
    let stopping = false;
    let releaseSlotTwo!: (processed: boolean) => void;
    let resolveFailedSlot!: () => void;
    let finished = false;
    const slotTwo = new Promise<boolean>((resolve) => (releaseSlotTwo = resolve));
    const failedSlot = new Promise<void>((resolve) => (resolveFailedSlot = resolve));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const pool = runAiWorkerPool({
        workerId: "process-worker",
        slots: 2,
        isStopping: () => stopping,
        wait: async () => {
          stopping = true;
          resolveFailedSlot();
        },
        processNext: async (_workerId, slot) => {
          if (slot === 1) throw new Error("slot failure");
          return slotTwo;
        },
      }).then(() => {
        finished = true;
      });

      await failedSlot;
      await Promise.resolve();
      expect(finished).toBe(false);
      releaseSlotTwo(true);
      await pool;
      expect(finished).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});
