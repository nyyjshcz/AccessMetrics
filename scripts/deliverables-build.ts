import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const options: Record<string, string> = {};
for (let index = 2; index < process.argv.length; index++) {
  if (!process.argv[index].startsWith("--")) continue;
  options[process.argv[index].slice(2)] = process.argv[index + 1] ?? "";
  index++;
}
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm deliverables:build -- --export-id <id> --report-data <absolute-json> --output-root <absolute-dir> --evidence-root <absolute-dir>",
  );
  process.exit(0);
}
const exportId = options["export-id"];
if (!exportId || !options["report-data"] || !options["output-root"] || !options["evidence-root"])
  throw new Error("需要 export-id、report-data、output-root 和 evidence-root");
for (const key of ["report-data", "output-root", "evidence-root"])
  if (!path.isAbsolute(options[key])) throw new Error(`--${key} 必须是绝对路径`);
const marker = path.join(options["evidence-root"], "deliverables", exportId, "R4-PASSED");
if (!fs.existsSync(marker))
  throw new Error("R4 candidate 未通过真人确认，拒绝生成 final deliverables");
if (!fs.existsSync(options["report-data"])) throw new Error("report-data 不存在，不能生成正式成果");
const outputs = [];
const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
for (const kind of ["research", "federation"]) {
  const result = spawnSync(
    process.execPath,
    [
      tsx,
      "scripts/generate-report.ts",
      "--input",
      options["report-data"],
      "--output-root",
      options["output-root"],
      "--kind",
      kind,
      "--mode",
      "final",
      "--evidence-root",
      options["evidence-root"],
      "--docx",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || `报告生成失败: ${kind}`);
  outputs.push(result.stdout.trim());
}
console.log(JSON.stringify({ status: "final_candidate_generated", exportId, outputs }, null, 2));
