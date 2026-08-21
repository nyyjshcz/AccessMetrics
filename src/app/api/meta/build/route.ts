import { NextResponse } from "next/server";
import { readBuildProvenance } from "@/lib/build-provenance";
export async function GET() {
  const provenance = readBuildProvenance();
  return NextResponse.json({
    app: "accesscheck-lishui",
    version: "1.0.0",
    scannerVersion: "accesscheck-scanner-v1",
    axeVersion: "4.13.0",
    catalogVersion: "wcag-2.2-axe-4.13.0-v1",
    buildCommit: provenance?.finalCandidate ?? null,
    provenance: provenance
      ? {
          schemaVersion: provenance.schemaVersion,
          finalCandidate: provenance.finalCandidate,
          rcCommit: provenance.rcCommit,
          verifiedTreeHash: provenance.verifiedTreeHash,
          fullGateBundleHash: provenance.fullGateBundleHash,
          validationAttestationHash: provenance.validationAttestationHash,
        }
      : null,
    publicRelease: Boolean(provenance),
  });
}
