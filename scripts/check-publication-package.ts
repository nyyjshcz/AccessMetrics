import fs from "node:fs";
import path from "node:path";
import { scanPublicationDirectory } from "../src/lib/privacy";
import { positionalArgs } from "./cli-args";
const [root, suppliedExportId] = positionalArgs();
const exportId = suppliedExportId ?? path.basename(root ?? "package");
if (!root)
  throw new Error("usage: pnpm tsx scripts/check-publication-package.ts <directory> [exportId]");
const report = scanPublicationDirectory(root, exportId);
fs.writeFileSync(path.join(root, "privacy-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
