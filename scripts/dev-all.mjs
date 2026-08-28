import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const lockPath = path.join(
  os.tmpdir(),
  `accesscheck-dev-${crypto.createHash("sha1").update(root).digest("hex").slice(0, 12)}.lock`,
);
const children = [];
let stopping = false;
let lockFd;

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lockFd = fs.openSync(lockPath, "wx");
      fs.writeSync(lockFd, String(process.pid));
      return;
    } catch {
      let pid = 0;
      try {
        pid = Number(fs.readFileSync(lockPath, "utf8").trim());
      } catch {
        // The other launcher may be between creating and writing the lock.
      }
      if (pid && processExists(pid)) {
        console.error(`local stack already running (pid ${pid})`);
        process.exit(1);
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // A concurrent launcher may have cleaned up the stale lock.
      }
    }
  }
  throw new Error("could not acquire local stack lock");
}

function releaseLock() {
  if (lockFd === undefined) return;
  try {
    fs.closeSync(lockFd);
  } catch {
    // The descriptor may already be closed during process shutdown.
  }
  lockFd = undefined;
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // The lock may have been removed after a stale-process recovery.
  }
}

function start(name, args) {
  const child = spawn(node, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push({ child, name });
  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    const status = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`[${name}] exited with ${status}; stopping local stack`);
    stop(code && code > 0 ? code : 1);
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500).unref();
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
process.once("exit", releaseLock);

acquireLock();
start("web", [nextCli, "dev", ...process.argv.slice(2)]);
start("scan-worker", [tsxCli, "--env-file-if-exists=.env.local", "src/worker/index.ts"]);
start("ai-worker", [tsxCli, "--env-file-if-exists=.env.local", "src/worker/ai.ts"]);
