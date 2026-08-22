import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sha256 } from "../src/lib/canonical";
import { verifyApprovedGate } from "./gate-utils";
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
const evidenceGates = path.join(options["evidence-root"], "gates");
verifyApprovedGate(evidenceGates, "R4", process.env.DATABASE_URL);
if (!fs.existsSync(options["report-data"])) throw new Error("report-data 不存在，不能生成正式成果");
const reportData = JSON.parse(fs.readFileSync(options["report-data"], "utf8")) as {
  exportId?: string;
  schemaVersion?: string;
};
if (reportData.schemaVersion !== "report-data-v1" || reportData.exportId !== exportId)
  throw new Error("report-data 必须是绑定当前 export-id 的正式 report-data-v1");
const outputs = [];
const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const outputRoot = path.resolve(options["output-root"]);
fs.mkdirSync(path.dirname(outputRoot), { recursive: true });
const temporaryRoot = fs.mkdtempSync(
  path.join(path.dirname(outputRoot), `.${path.basename(outputRoot)}-`),
);
try {
  for (const kind of ["research", "federation"]) {
    const result = spawnSync(
      process.execPath,
      [
        tsx,
        "scripts/generate-report.ts",
        "--input",
        options["report-data"],
        "--output-root",
        temporaryRoot,
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
    try {
      const generated = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      generated.output = path.join(outputRoot, "final", kind);
      generated.manifest = path.join(outputRoot, "final", kind, "report-manifest.json");
      outputs.push(JSON.stringify(generated));
    } catch {
      throw new Error(`报告生成器输出不是有效 JSON: ${kind}`);
    }
  }
  const generated = path.join(temporaryRoot, "final");
  const target = path.join(outputRoot, "final");
  const files = (directory: string): string[] => {
    const result: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory())
        result.push(...files(full).map((file) => path.join(entry.name, file)));
      else result.push(entry.name);
    }
    return result.sort();
  };
  const sameTree = (left: string, right: string) => {
    const leftFiles = files(left);
    const rightFiles = files(right);
    if (JSON.stringify(leftFiles) !== JSON.stringify(rightFiles)) return false;
    return leftFiles.every(
      (file) =>
        sha256(fs.readFileSync(path.join(left, file))) ===
        sha256(fs.readFileSync(path.join(right, file))),
    );
  };
  if (fs.existsSync(target)) {
    if (!sameTree(generated, target)) throw new Error("已有 final deliverables 内容不同，拒绝覆盖");
    console.log(JSON.stringify({ status: "reused", exportId, outputs }, null, 2));
  } else {
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.renameSync(generated, target);
    console.log(
      JSON.stringify({ status: "final_candidate_generated", exportId, outputs }, null, 2),
    );
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
