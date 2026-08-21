import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { hashReceiptSet, verifyApprovedGate, listGateFiles } from "./gate-utils";

if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm gates:index -- --through R4 --evidence-path <absolute-private-gates-directory>",
  );
  process.exit(0);
}
const through = process.argv[process.argv.indexOf("--through") + 1];
const evidencePath = process.argv[process.argv.indexOf("--evidence-path") + 1];
if (through !== "R4" || !evidencePath || !path.isAbsolute(evidencePath))
  throw new Error("gates:index requires --through R4 and an absolute --evidence-path");
const receipts: Array<{ path: string; sha256: string }> = [];
const receiptRecords: Array<{ path: string; receiptHash: string; role: string; revision: number }> =
  [];
for (const gate of ["R1", "R2", "R3", "R4"]) {
  const verified = verifyApprovedGate(evidencePath, gate as "R1" | "R2" | "R3" | "R4");
  for (const file of verified.files)
    receipts.push({ path: path.join(gate, file.path).replaceAll("\\", "/"), sha256: file.sha256 });
  for (const { file, receipt } of verified.selected)
    receiptRecords.push({
      path: path.join(gate, file.path).replaceAll("\\", "/"),
      receiptHash: receipt.receiptHash,
      role: receipt.role,
      revision: receipt.revision,
    });
}
if (receipts.length === 0) throw new Error("no verified R1-R4 receipt files found");
receipts.sort((a, b) => a.path.localeCompare(b.path));
const r4Gates = ["R1", "R2", "R3", "R4"] as const;
const allR4Receipts = r4Gates.flatMap((gate) => verifyApprovedGate(evidencePath, gate).selected);
const index = {
  schemaVersion: "gate-attestation-index-v1",
  throughGate: "R4",
  r5Status: "not_yet_recorded",
  r4EvidenceBundleHash: sha256(canonicalize(receipts)),
  fullGateBundleHash: null,
  receipts,
  receiptRecords: receiptRecords.sort((a, b) => a.path.localeCompare(b.path)),
  receiptSetHash: hashReceiptSet(allR4Receipts),
  status: "R4_INDEXED",
};
const target = path.join(process.cwd(), "docs", "gate-attestation-index.json");
fs.writeFileSync(target, `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ status: "indexed", target, receiptCount: receipts.length }, null, 2));
