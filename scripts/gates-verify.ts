import fs from "node:fs";
import path from "node:path";
import { requireApprovedRoleReceipts, listEvidenceFiles } from "./gate-utils";
import { positionalArgs } from "./cli-args";
const [providedRoot] = positionalArgs();
const root =
  providedRoot ??
  path.join(
    process.env.PRIVATE_EVIDENCE_ROOT ?? path.join(process.cwd(), "private-inputs"),
    "gates",
  );
if (!path.isAbsolute(root)) throw new Error("gates:verify root must be absolute");
const missing: string[] = [];
const verified: Record<string, { receiptCount: number; fileCount: number }> = {};
for (const gate of ["R1", "R2", "R3", "R4", "R5"] as const) {
  try {
    const result = requireApprovedRoleReceipts(root, gate);
    verified[gate] = { receiptCount: result.selected.length, fileCount: result.files.length };
  } catch {
    missing.push(gate);
  }
}
const r5Bundle = path.join(root, "R5", "r5-artifact-bundle.json");
if (!missing.includes("R5") && !fs.existsSync(r5Bundle)) missing.push("R5:r5-artifact-bundle.json");
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
      verifiedGates: verified,
      fileCount,
      checkedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
if (missing.length) process.exitCode = 1;
