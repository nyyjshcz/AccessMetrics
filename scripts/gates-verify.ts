import fs from "node:fs";
import path from "node:path";
import { listEvidenceFiles, verifyApprovedGate } from "./gate-utils";
import { positionalArgs } from "./cli-args";
const argv = process.argv.slice(2);
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
console.log(
  JSON.stringify(
    {
      root,
      verified: missing.length === 0,
      missing,
      errors,
      verifiedGates: verified,
      fileCount,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
if (missing.length) process.exitCode = 1;
