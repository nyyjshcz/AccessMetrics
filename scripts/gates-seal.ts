import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { git } from "./release-utils";
import { verifyApprovedGate, listGateFiles, listEvidenceFiles } from "./gate-utils";

if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm gates:seal -- --rc-commit <sha> --evidence-path <absolute-private-gates-directory>",
  );
  process.exit(0);
}
const commit = process.argv[process.argv.indexOf("--rc-commit") + 1];
const evidencePath = process.argv[process.argv.indexOf("--evidence-path") + 1];
if (!commit || !evidencePath || !path.isAbsolute(evidencePath))
  throw new Error("gates:seal requires commit and absolute evidence path");
const indexPath = path.join(process.cwd(), "docs", "gate-attestation-index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
if (index.throughGate !== "R4" || index.r5Status === "passed")
  throw new Error("R1-R4 index must exist and R5 must not already be sealed");
if (!/^[a-f0-9]{40}$/.test(commit) || git("rev-parse", commit) !== commit)
  throw new Error("--rc-commit must be an existing full commit SHA");
const r4Gates = ["R1", "R2", "R3", "R4"] as const;
for (const gate of r4Gates) verifyApprovedGate(evidencePath, gate);
const r4Hash = sha256(
  canonicalize(
    listGateFiles(evidencePath, r4Gates).map((file) => ({ path: file.path, sha256: file.sha256 })),
  ),
);
if (index.r4EvidenceBundleHash !== r4Hash) throw new Error("R1-R4 evidence changed after indexing");
const r5Verified = verifyApprovedGate(evidencePath, "R5");
const r5Receipts = r5Verified.selected.map(({ receipt }) => receipt);
if (r5Receipts.some((receipt) => receipt.boundCommit !== commit))
  throw new Error("both R5 receipts must bind the exact rc commit");
const bundleFile = r5Verified.files.find(
  (file) => path.basename(file.path) === "r5-artifact-bundle.json",
);
if (!bundleFile) throw new Error("R5 common artifact bundle is required");
let bundle: any;
try {
  bundle = JSON.parse(bundleFile.bytes.toString("utf8"));
} catch {
  throw new Error("R5 artifact bundle is not valid JSON");
}
if (
  bundle.schemaVersion !== "r5-artifact-bundle-v1" ||
  bundle.status !== "verified" ||
  !Array.isArray(bundle.artifactHashes) ||
  !/^[a-f0-9]{64}$/.test(bundle.bundleHash)
)
  throw new Error("R5 artifact bundle schema is invalid");
const expectedBundleHash = sha256(
  canonicalize({
    schemaVersion: bundle.schemaVersion,
    artifactHashes: bundle.artifactHashes,
    status: bundle.status,
  }),
);
if (bundle.bundleHash !== expectedBundleHash) throw new Error("R5 artifact bundle hash mismatch");
const bundleFileHash = sha256(bundleFile.bytes);
if (
  r5Receipts.some(
    (receipt) =>
      !receipt.artifacts.some(
        (artifact) =>
          artifact.logicalId === "r5-artifact-bundle.json" && artifact.sha256 === bundleFileHash,
      ),
  )
)
  throw new Error("两份 R5 receipt 必须绑定同一 r5-artifact-bundle.json 字节");
const files = listEvidenceFiles(path.join(evidencePath, "R5")).map((file) => ({
  path: file.path,
  sha256: file.sha256,
}));
const fullGateBundleHash = sha256(
  canonicalize({
    r4: index.r4EvidenceBundleHash,
    r5: files,
    r5ArtifactBundleHash: bundle.bundleHash,
    r5Receipts: r5Receipts.map((receipt) => receipt.receiptHash).sort(),
  }),
);
const next = {
  ...index,
  throughGate: "R5",
  r5Status: "passed",
  rcCommit: commit,
  fullGateBundleHash,
  r5ArtifactBundleHash: bundle.bundleHash,
  r5Receipts: r5Receipts.map((receipt) => receipt.receiptHash).sort(),
  status: "R5_SEALED",
};
fs.writeFileSync(indexPath, `${JSON.stringify(next, null, 2)}\n`);
const logPath = path.join(process.cwd(), "docs", "validation-log.md");
fs.appendFileSync(
  logPath,
  `\n| ${new Date().toISOString().slice(0, 10)} | R5 gate seal | AI | 真人已提供 schema-valid 双 receipt（由命令核验） | pnpm gates:seal | fullGateBundleHash=${fullGateBundleHash} | clean-clone/release validation 仍需继续 |\n`,
);
console.log(
  JSON.stringify(
    { status: "sealed", note: "Only run after two real R5 reviewer receipts", fullGateBundleHash },
    null,
    2,
  ),
);
