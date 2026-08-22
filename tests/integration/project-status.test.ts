import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize, sha256 } from "../../src/lib/canonical";
import {
  externalDeliveryAttestationPath,
  verifyExternalDeliveryAttestation,
} from "../../scripts/external-delivery";

describe("external delivery status evidence", () => {
  it("stays incomplete when the private attestation is absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-delivery-"));
    try {
      const result = verifyExternalDeliveryAttestation(root);
      expect(result.passed).toBe(false);
      if (result.passed) throw new Error("missing receipt unexpectedly passed");
      expect(result.reason).toBe("missing attestation");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only a schema-valid canonical-hash attestation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-delivery-"));
    try {
      const attestation = {
        schemaVersion: "external-delivery-attestation-v1" as const,
        status: "accepted" as const,
        deliveryId: "delivery-001",
        deliveryMode: "recipient_submission" as const,
        releaseTag: "research-v1",
        finalCandidate: "a".repeat(40),
        deliveredAt: "2026-08-22T00:00:00.000Z",
        deliveredBy: "负责人",
        recipient: "接收单位",
        artifacts: [{ path: "report.pdf", sha256: "b".repeat(64) }],
        attestationHash: "",
      };
      attestation.attestationHash = sha256(
        canonicalize({ ...attestation, attestationHash: undefined }),
      );
      const filePath = externalDeliveryAttestationPath(root);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(attestation, null, 2)}\n`);
      const result = verifyExternalDeliveryAttestation(root);
      expect(result.passed).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a tampered receipt hash", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-delivery-"));
    try {
      const filePath = externalDeliveryAttestationPath(root);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ schemaVersion: "external-delivery-attestation-v1" }),
      );
      const result = verifyExternalDeliveryAttestation(root);
      expect(result.passed).toBe(false);
      if (result.passed) throw new Error("tampered receipt unexpectedly passed");
      expect(result.reason).toBe("schema validation failed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
