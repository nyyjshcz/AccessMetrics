import fs from "node:fs";
import path from "node:path";

export type BuildProvenance = {
  schemaVersion: "build-provenance-v1";
  finalCandidate: string;
  rcCommit: string;
  verifiedTreeHash: string;
  fullGateBundleHash: string;
  validationAttestationHash: string;
  builtAt: string;
  builderVersion: string;
};

export function readBuildProvenance(): BuildProvenance | null {
  const file = path.join(process.cwd(), "build-provenance.json");
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BuildProvenance>;
    if (
      value.schemaVersion !== "build-provenance-v1" ||
      typeof value.finalCandidate !== "string" ||
      !/^[a-f0-9]{40}$/.test(value.finalCandidate) ||
      typeof value.rcCommit !== "string" ||
      !/^[a-f0-9]{40}$/.test(value.rcCommit) ||
      typeof value.verifiedTreeHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.verifiedTreeHash) ||
      typeof value.fullGateBundleHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.fullGateBundleHash) ||
      typeof value.validationAttestationHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.validationAttestationHash) ||
      typeof value.builtAt !== "string" ||
      typeof value.builderVersion !== "string"
    )
      return null;
    return value as BuildProvenance;
  } catch {
    return null;
  }
}
