import fs from "node:fs";
import path from "node:path";
import { scanPublicationDirectory } from "../src/lib/privacy";
import { positionalArgs } from "./cli-args";
if (process.argv.includes("--help")) {
  console.log("usage: pnpm publication:preflight -- <export-directory> <export-id>");
  process.exit(0);
}
const [root, exportId] = positionalArgs();
if (!root || !exportId) throw new Error("usage: pnpm publication:preflight <directory> <exportId>");
const report = scanPublicationDirectory(path.resolve(root), exportId);
fs.writeFileSync(path.join(root, "privacy-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(report.passed ? "PUBLICATION_PREFLIGHT_PASSED" : "PUBLICATION_PREFLIGHT_FAILED");
if (!report.passed) process.exitCode = 1;
