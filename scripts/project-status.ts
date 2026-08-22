import fs from "node:fs";
import path from "node:path";
import { verifyApprovedGate } from "./gate-utils";
import { verifyExternalDeliveryAttestation } from "./external-delivery";

const root = process.cwd();
const external = fs.readFileSync(path.join(root, "EXTERNAL_INPUTS.md"), "utf8");
const required = [
  "package.json",
  "pnpm-lock.yaml",
  "src/lib/db.ts",
  "src/lib/browser.ts",
  "src/lib/scan-page.ts",
  "src/lib/score.ts",
  "src/worker/index.ts",
  "contracts/api.openapi.yaml",
  "contracts/external-delivery-attestation.schema.json",
  "tests/e2e/home.spec.ts",
  "analysis/reference_score.py",
  "Dockerfile",
  "docker-compose.yml",
  "scripts/check-repository-hygiene.ts",
  "scripts/check-documentation.ts",
  "scripts/check-egress-proxy.mjs",
  "scripts/scan-page-cli.ts",
  "scripts/import-sample-frame.ts",
  "scripts/run-formal-study.ts",
  "scripts/build-deliverables.ts",
  "scripts/resume-project.ts",
  "scripts/external-delivery.ts",
  "tools/egress-proxy/proxy.mjs",
  "compose.prod.yaml",
  "Caddyfile",
  "scripts/release-verify.ts",
  "scripts/release-image.ts",
  "scripts/release-publish-check.ts",
  "docs/release-notes.md",
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
const pending = external.split("\n").filter((line) => line.startsWith("- [ ]"));
const evidenceRoot = path.resolve(
  process.env.PRIVATE_EVIDENCE_ROOT ?? path.join(root, "private-inputs"),
);
const gateChecks: Record<string, { passed: boolean; reason?: string }> = {};
let earlierGateFailed = false;
const missingEvidence = ["R1", "R2", "R3", "R4", "R5"].filter((gate) => {
  if (earlierGateFailed) {
    gateChecks[gate] = {
      passed: false,
      reason: "earlier gate is not verified; gate order is invalid",
    };
    return true;
  }
  try {
    verifyApprovedGate(path.join(evidenceRoot, "gates"), gate as "R1" | "R2" | "R3" | "R4" | "R5");
    gateChecks[gate] = { passed: true };
    return false;
  } catch (error) {
    earlierGateFailed = true;
    gateChecks[gate] = {
      passed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
    return true;
  }
});
const qualityArtifacts = [
  "docs/dependency-preflight.json",
  "docs/validation-log.md",
  "contracts/examples/manifest.json",
  "docs/owner-handoff/07-理解检查参考答案与验收表.md",
].filter((file) => fs.existsSync(path.join(root, file)));
let attestationIndex: Record<string, unknown> | null = null;
try {
  attestationIndex = JSON.parse(
    fs.readFileSync(path.join(root, "docs", "gate-attestation-index.json"), "utf8"),
  );
} catch {
  // R4 has not generated the index yet.
}
const indexValid =
  attestationIndex !== null &&
  attestationIndex.schemaVersion === "gate-attestation-index-v1" &&
  typeof attestationIndex.throughGate === "string" &&
  typeof attestationIndex.r5Status === "string";
const automatedReady = missing.length === 0 && qualityArtifacts.length === 4 && indexValid;
const deliveryAttestation = verifyExternalDeliveryAttestation(root);
const researchComplete =
  attestationIndex?.throughGate === "R5" && attestationIndex?.r5Status === "passed";
const state = !automatedReady
  ? "IMPLEMENTING"
  : pending.length > 0 || missingEvidence.length > 0
    ? "WAITING_EXTERNAL_INPUT"
    : researchComplete
      ? deliveryAttestation.passed
        ? "EXTERNAL_DELIVERY_COMPLETE"
        : "RESEARCH_COMPLETE"
      : "AUTOMATED_IMPLEMENTATION_COMPLETE";

console.log(
  JSON.stringify(
    {
      state,
      automatedImplementation: automatedReady ? "AUTOMATED_IMPLEMENTATION_COMPLETE" : "incomplete",
      missing,
      externalInputsPending: pending.length,
      missingEvidence,
      gateChecks,
      qualityArtifacts,
      attestationIndex: attestationIndex
        ? {
            throughGate: attestationIndex.throughGate,
            r5Status: attestationIndex.r5Status,
            r4EvidenceBundleHash: attestationIndex.r4EvidenceBundleHash,
            fullGateBundleHash: attestationIndex.fullGateBundleHash,
          }
        : null,
      externalDelivery: {
        path: deliveryAttestation.path,
        passed: deliveryAttestation.passed,
        reason: deliveryAttestation.passed ? undefined : deliveryAttestation.reason,
      },
      checkedAt: new Date().toISOString(),
      qualityCommands: [
        "pnpm dependency:preflight",
        "pnpm catalog:check",
        "pnpm egress:check",
        "pnpm ops:check",
        "pnpm hygiene:check",
        "pnpm docs:check",
        "pnpm handoff:check",
        "pnpm contract:check",
        "pnpm lint",
        "pnpm format:check",
        "pnpm typecheck",
        "pnpm test",
        "pnpm test:e2e",
        "pnpm test:analysis",
        "pnpm build",
        "pnpm test:all",
      ],
    },
    null,
    2,
  ),
);
