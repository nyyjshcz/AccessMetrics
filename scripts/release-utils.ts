import fs from "node:fs";
import { execFileSync } from "node:child_process";
export function args() {
  const result: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--") continue;
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=", 2);
      result[key] = value ?? process.argv[++i] ?? "";
    }
  }
  return result;
}
export function git(...params: string[]) {
  return execFileSync("git", params, { encoding: "utf8" }).trim();
}
export function writeJsonAtomic(file: string, value: unknown) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(require("node:path").dirname(file), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temp, file);
}
