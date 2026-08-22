import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { canonicalize, sha256 } from "../src/lib/canonical";

const artifactSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .refine((value) => !value.startsWith("/") && !value.includes("\\")),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const attestationSchema = z
  .object({
    schemaVersion: z.literal("external-delivery-attestation-v1"),
    status: z.literal("accepted"),
    deliveryId: z.string().min(1).max(200),
    deliveryMode: z.enum(["public_web", "github_release", "recipient_submission", "local_handoff"]),
    releaseTag: z.string().regex(/^[A-Za-z0-9._/-]+$/),
    finalCandidate: z.string().regex(/^[0-9a-f]{40}$/),
    deliveredAt: z.string().datetime({ offset: true }),
    deliveredBy: z.string().min(1).max(200),
    recipient: z.string().min(1).max(300),
    publicationUrl: z.string().url().max(2048).optional(),
    githubReleaseUrl: z.string().url().max(2048).optional(),
    artifacts: z.array(artifactSchema).min(1),
    attestationHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type ExternalDeliveryAttestation = z.infer<typeof attestationSchema>;

export function externalDeliveryAttestationPath(root = process.cwd()) {
  return path.resolve(
    root,
    process.env.PRIVATE_EVIDENCE_ROOT ?? "private-inputs",
    "external-delivery",
    "attestation.json",
  );
}

export function verifyExternalDeliveryAttestation(
  root = process.cwd(),
):
  | { passed: true; path: string; attestation: ExternalDeliveryAttestation }
  | { passed: false; path: string; reason: string } {
  const filePath = externalDeliveryAttestationPath(root);
  if (!fs.existsSync(filePath))
    return { passed: false, path: filePath, reason: "missing attestation" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { passed: false, path: filePath, reason: "invalid JSON" };
  }
  const result = attestationSchema.safeParse(parsed);
  if (!result.success) return { passed: false, path: filePath, reason: "schema validation failed" };
  const { attestationHash, ...withoutHash } = result.data;
  const expectedHash = sha256(canonicalize(withoutHash));
  if (attestationHash !== expectedHash)
    return { passed: false, path: filePath, reason: "attestationHash mismatch" };
  return { passed: true, path: filePath, attestation: result.data };
}
