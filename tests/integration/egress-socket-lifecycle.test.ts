import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
describe("egress proxy survives disconnected tunnels", () => {
  it.each([
    ["connect", "resolving", "ECONNRESET"],
    ["connect", "connected", "EPIPE"],
    ["upgrade", "resolving", "EPIPE"],
    ["upgrade", "connected", "ECONNRESET"],
  ])("handles %s %s %s and keeps serving", async (protocol, phase, code) => {
    const result = await run(process.execPath, [
      path.resolve("tests/fixtures/egress-socket-lifecycle.mjs"), protocol, phase, code,
    ], { timeout: 8000 });
    expect(result.stdout).toContain("socket lifecycle passed");
  }, 10000);
});
