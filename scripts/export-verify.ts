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
  files?: Array<{ path: string; size: number; sha256: string }>;
};
for (const file of manifest.files ?? []) {
  if (!file.path || path.isAbsolute(file.path) || file.path.includes(".."))
    throw new Error(`unsafe manifest path: ${file.path}`);
  const payload = path.join(directory, file.path);
  if (!fs.existsSync(payload)) throw new Error(`missing payload: ${file.path}`);
  const bytes = fs.readFileSync(payload);
  if (bytes.length !== file.size || sha256(bytes) !== file.sha256)
    throw new Error(`payload hash mismatch: ${file.path}`);
}
console.log(
  JSON.stringify({ verified: true, manifestHash: actual, fileCount: manifest.files?.length ?? 0 }),
);
