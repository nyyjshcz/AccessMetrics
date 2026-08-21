import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { listEvidenceFiles, listGateFiles, verifyApprovedGate } from "./gate-utils";
import { positionalArgs } from "./cli-args";
const argv = process.argv.slice(2);
if (argv.includes("--help")) {
  console.log("usage: pnpm gates:verify -- --evidence-path <absolute-private-gates-directory>");
  process.exit(0);
}
const flagIndex = argv.indexOf("--evidence-path");
const providedRoot =
  flagIndex >= 0
    ? argv[flagIndex + 1]
    : positionalArgs(argv).find((argument) => !argument.startsWith("-"));
const root =
  providedRoot ??
  path.join(
    process.env.PRIVATE_EVIDENCE_ROOT ?? path.join(process.cwd(), "private-inputs"),
    "gates",
  );
if (!path.isAbsolute(root)) throw new Error("gates:verify root must be absolute");
const missing: string[] = [];
const errors: Record<string, string> = {};
const verified: Record<string, { receiptCount: number; fileCount: number }> = {};
const gateResults: Record<string, ReturnType<typeof verifyApprovedGate>> = {};
for (const gate of ["R1", "R2", "R3", "R4", "R5"] as const) {
  try {
    const result = verifyApprovedGate(root, gate);
    gateResults[gate] = result;
    verified[gate] = { receiptCount: result.selected.length, fileCount: result.files.length };
  } catch (error) {
    missing.push(gate);
    errors[gate] = error instanceof Error ? error.message : String(error);
  }
}
let earlierGateFailed = false;
for (const gate of ["R1", "R2", "R3", "R4", "R5"] as const) {
  if (earlierGateFailed && verified[gate]) {
    delete verified[gate];
    if (!missing.includes(gate)) missing.push(gate);
    errors[gate] = "an earlier gate is not verified; gate order is invalid";
  }
  if (!verified[gate]) earlierGateFailed = true;
}
const r5 = gateResults.R5;
if (r5 && verified.R5) {
  const commits = r5.selected.map(({ receipt }) => receipt.boundCommit);
  if (
    commits.some((commit) => typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)) ||
    new Set(commits).size !== 1
  ) {
    delete verified.R5;
    if (!missing.includes("R5")) missing.push("R5");
    errors.R5 = "R5 receipts must bind the same full 40-character rcCommit";
  }
}
const r5Bundle = path.join(root, "R5", "r5-artifact-bundle.json");
if (!missing.includes("R5") && !fs.existsSync(r5Bundle)) {
  missing.push("R5");
  errors.R5 = "R5 common artifact bundle is missing";
}
const fileCount = ["R1", "R2", "R3", "R4", "R5"].reduce((total, gate) => {
  try {
    return total + listEvidenceFiles(path.join(root, gate)).length;
  } catch {
    return total;
  }
}, 0);
let r4EvidenceBundleHash: string | null = null;
let fullGateBundleHash: string | null = null;
try {
  const r4Files = listGateFiles(root, ["R1", "R2", "R3", "R4"]).map((file) => ({
    path: file.path,
    sha256: file.sha256,
  }));
  r4EvidenceBundleHash = sha256(canonicalize(r4Files));
  const r5Files = listEvidenceFiles(path.join(root, "R5")).map((file) => ({
    path: file.path,
    sha256: file.sha256,
  }));
  const r5Bundle = gateResults.R5?.files.find((file) => file.path === "r5-artifact-bundle.json");
  let bundleHash: string | null = null;
  if (r5Bundle) {
    try {
      const bundle = JSON.parse(r5Bundle.bytes.toString("utf8")) as { bundleHash?: unknown };
      bundleHash = typeof bundle.bundleHash === "string" ? bundle.bundleHash : null;
    } catch {
      bundleHash = null;
    }
  }
  if (gateResults.R5 && verified.R5 && bundleHash) {
    fullGateBundleHash = sha256(
      canonicalize({
        r4: r4EvidenceBundleHash,
        r5: r5Files,
        r5ArtifactBundleHash: bundleHash,
        r5Receipts: gateResults.R5.selected.map(({ receipt }) => receipt.receiptHash).sort(),
      }),
    );
  }
} catch (error) {
  errors.hashes = error instanceof Error ? error.message : String(error);
}
const indexPath = path.join(process.cwd(), "docs", "gate-attestation-index.json");
if (fs.existsSync(indexPath)) {
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as Record<string, unknown>;
    if (
      index.throughGate === "R4" &&
      r4EvidenceBundleHash &&
      index.r4EvidenceBundleHash !== r4EvidenceBundleHash
    )
      errors.index = "公开 gate index 的 R4 hash 与当前证据不一致";
    if (
      index.throughGate === "R5" &&
      fullGateBundleHash &&
      index.fullGateBundleHash !== fullGateBundleHash
    )
      errors.index = "公开 gate index 的 full hash 与当前证据不一致";
    if (index.throughGate === "R5" && index.r5Status !== "passed")
      errors.index = "公开 gate index 标记的 R5 状态不是 passed";
  } catch {
    errors.index = "公开 gate index 不是有效 JSON";
  }
}
console.log(
  JSON.stringify(
    {
      root,
      verified: missing.length === 0 && Object.keys(errors).length === 0,
      missing,
      errors,
      r4EvidenceBundleHash,
      fullGateBundleHash,
      verifiedGates: verified,
      fileCount,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
if (missing.length) process.exitCode = 1;
