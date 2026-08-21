import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "../src/lib/canonical";

export const GATES = ["R1", "R2", "R3", "R4", "R5"] as const;
export const ROLES = ["computer_lead", "math_lead"] as const;
export type Gate = (typeof GATES)[number];
export type GateRole = (typeof ROLES)[number];

export type GateReceipt = {
  schemaVersion: "human-gate-receipt-v1";
  evidenceId: string;
  gateId: Gate;
  campaignId: string | null;
  role: GateRole;
  decision: "approved" | "rejected";
  statementVersion: string;
  boundCommit: string | null;
  artifacts: Array<{ logicalId: string; sha256: string }>;
  note: string;
  revision: number;
  reviewedAt: string;
  receiptHash: string;
};

export type EvidenceFile = { path: string; sha256: string; bytes: Buffer };

const HEX = /^[a-f0-9]{64}$/;

function assertSafeRelative(relative: string) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
    throw new Error(`unsafe evidence path: ${relative}`);
}

export function listEvidenceFiles(root: string): EvidenceFile[] {
  const resolvedRoot = path.resolve(root);
  if (!path.isAbsolute(root)) throw new Error("evidence root must be absolute");
  if (!fs.existsSync(resolvedRoot)) throw new Error(`missing evidence root: ${resolvedRoot}`);
  const files: EvidenceFile[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`evidence symlink is not allowed: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(resolvedRoot, absolute).replaceAll(path.sep, "/");
        assertSafeRelative(relative);
        const bytes = fs.readFileSync(absolute);
        files.push({ path: relative, sha256: sha256(bytes), bytes });
      } else throw new Error(`unsupported evidence entry: ${absolute}`);
    }
  };
  walk(resolvedRoot);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function parseJson(file: EvidenceFile): unknown {
  try {
    return JSON.parse(file.bytes.toString("utf8"));
  } catch {
    return undefined;
  }
}

export function validateReceipt(
  value: unknown,
  expectedGate?: Gate,
  expectedRole?: GateRole,
): GateReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("receipt must be an object");
  const record = value as Record<string, unknown>;
  const required = [
    "schemaVersion",
    "evidenceId",
    "gateId",
    "campaignId",
    "role",
    "decision",
    "statementVersion",
    "boundCommit",
    "artifacts",
    "note",
    "revision",
    "reviewedAt",
    "receiptHash",
  ];
  const unknown = Object.keys(record).filter((key) => !required.includes(key));
  if (unknown.length) throw new Error(`receipt contains unknown fields: ${unknown.join(",")}`);
  if (record.schemaVersion !== "human-gate-receipt-v1")
    throw new Error("invalid receipt schemaVersion");
  if (!GATES.includes(record.gateId as Gate)) throw new Error("invalid receipt gateId");
  if (expectedGate && record.gateId !== expectedGate) throw new Error("receipt gate mismatch");
  if (!ROLES.includes(record.role as GateRole)) throw new Error("invalid receipt role");
  if (expectedRole && record.role !== expectedRole) throw new Error("receipt role mismatch");
  if (record.campaignId !== null && typeof record.campaignId !== "string")
    throw new Error("invalid campaignId");
  if (record.decision !== "approved" && record.decision !== "rejected")
    throw new Error("invalid gate decision");
  if (typeof record.statementVersion !== "string" || !record.statementVersion)
    throw new Error("invalid statementVersion");
  if (record.boundCommit !== null && typeof record.boundCommit !== "string")
    throw new Error("invalid boundCommit");
  if (typeof record.note !== "string" || record.note.length > 2000)
    throw new Error("invalid receipt note");
  if (!Number.isInteger(record.revision) || Number(record.revision) < 1)
    throw new Error("invalid receipt revision");
  if (typeof record.reviewedAt !== "string" || !record.reviewedAt)
    throw new Error("invalid reviewedAt");
  if (typeof record.evidenceId !== "string" || !record.evidenceId)
    throw new Error("invalid evidenceId");
  if (!Array.isArray(record.artifacts)) throw new Error("receipt artifacts must be an array");
  const artifactIds = new Set<string>();
  for (const artifact of record.artifacts) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact))
      throw new Error("invalid receipt artifact");
    const item = artifact as Record<string, unknown>;
    if (typeof item.logicalId !== "string" || !item.logicalId || artifactIds.has(item.logicalId))
      throw new Error("receipt artifact logicalId must be unique");
    if (!HEX.test(String(item.sha256))) throw new Error(`invalid artifact hash: ${item.logicalId}`);
    assertSafeRelative(item.logicalId);
    artifactIds.add(item.logicalId);
  }
  if (!HEX.test(String(record.receiptHash))) throw new Error("invalid receiptHash");
  const { receiptHash: _ignored, ...withoutHash } = record;
  if (sha256(canonicalize(withoutHash)) !== record.receiptHash)
    throw new Error("receiptHash does not match receipt bytes");
  return record as unknown as GateReceipt;
}

export function findReceipts(root: string, gate: Gate) {
  const files = listEvidenceFiles(path.join(root, gate));
  const receipts: Array<{ file: EvidenceFile; receipt: GateReceipt }> = [];
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".json")) continue;
    const parsed = parseJson(file);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as Record<string, unknown>).schemaVersion !== "human-gate-receipt-v1"
    )
      continue;
    receipts.push({ file, receipt: validateReceipt(parsed, gate) });
  }
  return { files, receipts };
}

export function requireApprovedRoleReceipts(root: string, gate: Gate) {
  const result = findReceipts(root, gate);
  const selected = ROLES.map((role) => {
    const candidates = result.receipts
      .filter((item) => item.receipt.role === role)
      .sort(
        (a, b) => b.receipt.revision - a.receipt.revision || a.file.path.localeCompare(b.file.path),
      );
    if (!candidates.length) throw new Error(`missing ${gate} receipt for ${role}`);
    const current = candidates[0];
    if (current.receipt.decision !== "approved") throw new Error(`${gate} ${role} is not approved`);
    if (candidates.filter((item) => item.receipt.revision === current.receipt.revision).length > 1)
      throw new Error(`ambiguous current ${gate} receipt for ${role}`);
    return current;
  });
  return { ...result, selected };
}

export function hashReceiptSet(receipts: Array<{ file: EvidenceFile; receipt: GateReceipt }>) {
  return sha256(
    canonicalize(
      receipts.map(({ file, receipt }) => ({
        path: file.path,
        sha256: file.sha256,
        receiptHash: receipt.receiptHash,
      })),
    ),
  );
}

export function listGateFiles(root: string, gates: readonly Gate[]) {
  return gates
    .flatMap((gate) =>
      listEvidenceFiles(path.join(root, gate)).map((file) => ({
        ...file,
        path: `${gate}/${file.path}`.replaceAll("\\", "/"),
      })),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}
