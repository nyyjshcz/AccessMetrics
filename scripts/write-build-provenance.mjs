import fs from "node:fs";
import path from "node:path";
const positional = process.argv.slice(2).filter((argument) => argument !== "--");

const values = {
  schemaVersion: "build-provenance-v1",
  finalCandidate: process.env.ACCESSCHECK_FINAL_CANDIDATE ?? "",
  rcCommit: process.env.ACCESSCHECK_RC_COMMIT ?? "",
  verifiedTreeHash: process.env.ACCESSCHECK_VERIFIED_TREE_HASH ?? "",
  fullGateBundleHash: process.env.ACCESSCHECK_FULL_GATE_BUNDLE_HASH ?? "",
  validationAttestationHash: process.env.ACCESSCHECK_VALIDATION_ATTESTATION_HASH ?? "",
  builtAt: process.env.ACCESSCHECK_BUILT_AT ?? new Date().toISOString(),
  builderVersion: process.env.ACCESSCHECK_BUILDER_VERSION ?? "release-image-v2",
};
const required = [
  ["finalCandidate", /^[a-f0-9]{40}$/],
  ["rcCommit", /^[a-f0-9]{40}$/],
  ["verifiedTreeHash", /^[a-f0-9]{64}$/],
  ["fullGateBundleHash", /^[a-f0-9]{64}$/],
  ["validationAttestationHash", /^[a-f0-9]{64}$/],
];
for (const [key, pattern] of required) {
  if (!pattern.test(values[key])) throw new Error(`invalid build provenance: ${key}`);
}
const output = positional[0] ?? path.join(process.cwd(), "build-provenance.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(values, null, 2)}\n`);
