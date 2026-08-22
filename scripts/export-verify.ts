import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../src/lib/canonical";
import { positionalArgs } from "./cli-args";

if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm export:verify -- <absolute-export-directory> [expected-manifest-sha256]",
  );
  process.exit(0);
}
const [directory, expected] = positionalArgs();
if (!directory || !path.isAbsolute(directory)) throw new Error("export directory must be absolute");
const manifestPath = path.join(directory, "manifest.json");
const digestPath = path.join(directory, "manifest.sha256");
if (!fs.existsSync(manifestPath) || !fs.existsSync(digestPath))
  throw new Error("manifest.json and manifest.sha256 are required");
const manifestBytes = fs.readFileSync(manifestPath);
const actual = sha256(manifestBytes);
const recorded = fs.readFileSync(digestPath, "utf8").trim();
if (actual !== recorded || (expected && expected !== actual))
  throw new Error(`manifest hash mismatch: ${actual}`);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  schemaVersion?: string;
  exportId?: string;
  exportKind?: string;
  files?: Array<{ path: string; size: number; sha256: string }>;
};
if (manifest.schemaVersion !== "canonical-manifest-json-v1" || !manifest.exportId)
  throw new Error("manifest schemaVersion/exportId 无效");
if (!Array.isArray(manifest.files)) throw new Error("manifest.files 必须是数组");
const seen = new Set<string>();
for (const file of manifest.files ?? []) {
  if (!file.path || path.isAbsolute(file.path) || file.path.includes(".."))
    throw new Error(`unsafe manifest path: ${file.path}`);
  if (file.path === "manifest.json" || file.path === "manifest.sha256" || seen.has(file.path))
    throw new Error(`manifest files cannot self-list or repeat: ${file.path}`);
  seen.add(file.path);
  const payload = path.join(directory, file.path);
  if (!fs.existsSync(payload)) throw new Error(`missing payload: ${file.path}`);
  const bytes = fs.readFileSync(payload);
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256)
    throw new Error(`payload hash mismatch: ${file.path}`);
  if (path.extname(file.path).toLowerCase() === ".csv" && "rows" in file) {
    const rows = Math.max(
      0,
      bytes
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .split("\r\n")
        .filter((line) => line.length > 0).length - 1,
    );
    if (rows !== (file as { rows?: number }).rows)
      throw new Error(`CSV row count mismatch: ${file.path}`);
  }
}
const studyJson = path.join(directory, "data", "study.json");
if (fs.existsSync(studyJson)) {
  const value = JSON.parse(fs.readFileSync(studyJson, "utf8")) as Record<string, unknown>;
  if (
    value.schemaVersion !== "study-export-v1" ||
    typeof value.exportId !== "string" ||
    value.exportId !== manifest.exportId ||
    !["study_source", "study_final"].includes(String(value.exportKind)) ||
    !Array.isArray(value.runSet)
  )
    throw new Error("data/study.json schema 或 manifest 绑定无效");
}
console.log(
  JSON.stringify({ verified: true, manifestHash: actual, fileCount: manifest.files?.length ?? 0 }),
);
