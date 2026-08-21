import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
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

function sortedArtifacts(artifacts: GateReceipt["artifacts"]) {
  return artifacts
    .map((artifact) => ({ logicalId: artifact.logicalId, sha256: artifact.sha256 }))
    .sort((a, b) => a.logicalId.localeCompare(b.logicalId));
}

function verifyDatabaseBindings(
  gate: Gate,
  selected: Array<{ file: EvidenceFile; receipt: GateReceipt }>,
  databasePathOverride?: string,
) {
  const configuredPath =
    databasePathOverride ?? process.env.DATABASE_URL ?? path.join("data", "accesscheck.db");
  const databasePath = path.resolve(process.cwd(), configuredPath);
  if (!fs.existsSync(databasePath)) throw new Error(`database is missing: ${databasePath}`);
  let db: Database.Database;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new Error(
      `database cannot be opened: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    for (const { file, receipt } of selected) {
      const row = db
        .prepare(
          `SELECT e.gate_id,e.role,e.decision,e.is_current,e.bound_commit,e.artifacts_json,e.receipt_hash,
                  o.target_relpath,o.receipt_json,o.expected_file_hash,o.status
             FROM human_gate_evidence e
             LEFT JOIN human_gate_evidence_outbox o ON o.evidence_id=e.id
            WHERE e.receipt_hash=?`,
        )
        .get(receipt.receiptHash) as
        | {
            gate_id: string;
            role: string;
            decision: string;
            is_current: number;
            bound_commit: string | null;
            artifacts_json: string;
            receipt_hash: string;
            target_relpath: string | null;
            receipt_json: string | null;
            expected_file_hash: string | null;
            status: string | null;
          }
        | undefined;
      if (!row) throw new Error(`${gate} ${receipt.role} is absent from the evidence database`);
      if (
        row.gate_id !== gate ||
        row.role !== receipt.role ||
        row.decision !== "approved" ||
        row.is_current !== 1 ||
        row.receipt_hash !== receipt.receiptHash
      )
        throw new Error(`${gate} ${receipt.role} database row is not the current approved receipt`);
      if (row.artifacts_json !== canonicalize(receipt.artifacts))
        throw new Error(`${gate} ${receipt.role} database artifact set differs from receipt`);
      const expectedPath = `gates/${gate}/${file.path}`;
      const targetPath = row.target_relpath?.replaceAll("\\", "/");
      if (targetPath !== expectedPath)
        throw new Error(`${gate} ${receipt.role} outbox target path mismatch`);
      if (row.status !== "written")
        throw new Error(`${gate} ${receipt.role} outbox is not written`);
      if (row.receipt_json !== file.bytes.toString("utf8"))
        throw new Error(`${gate} ${receipt.role} outbox bytes differ from evidence file`);
      if (row.expected_file_hash !== file.sha256)
        throw new Error(`${gate} ${receipt.role} outbox file hash mismatch`);
    }
  } finally {
    db.close();
  }
}

/**
 * Verify the evidence bytes referenced by the current approved receipts.
 * Merely finding two JSON receipts is not enough: every referenced artifact
 * must still exist with the recorded hash, and R5 must contain one common,
 * self-hashed six-artifact bundle bound by both roles.
 */
export function verifyApprovedGate(root: string, gate: Gate, databasePathOverride?: string) {
  const result = requireApprovedRoleReceipts(root, gate);
  const files = new Map(result.files.map((file) => [file.path, file]));
  for (const { file, receipt } of result.selected) {
    if (receipt.artifacts.length === 0)
      throw new Error(`${gate} ${receipt.role} receipt has no artifact references`);
    for (const artifact of receipt.artifacts) {
      const referenced = files.get(artifact.logicalId);
      if (!referenced)
        throw new Error(`${gate} ${receipt.role} missing artifact ${artifact.logicalId}`);
      if (referenced.sha256 !== artifact.sha256)
        throw new Error(`${gate} ${receipt.role} artifact hash mismatch: ${artifact.logicalId}`);
    }
  }
  verifyDatabaseBindings(gate, result.selected, databasePathOverride);
  if (gate !== "R5") return result;

  const bundleFile = files.get("r5-artifact-bundle.json");
  if (!bundleFile) throw new Error("R5 common artifact bundle is missing");
  let bundle: unknown;
  try {
    bundle = JSON.parse(bundleFile.bytes.toString("utf8"));
  } catch {
    throw new Error("R5 common artifact bundle is not valid JSON");
  }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle))
    throw new Error("R5 common artifact bundle must be an object");
  const bundleRecord = bundle as Record<string, unknown>;
  const keys = Object.keys(bundleRecord).sort();
  if (keys.join(",") !== "artifactHashes,bundleHash,schemaVersion,status")
    throw new Error("R5 common artifact bundle contains unknown fields");
  if (
    bundleRecord.schemaVersion !== "r5-artifact-bundle-v1" ||
    bundleRecord.status !== "verified" ||
    !Array.isArray(bundleRecord.artifactHashes) ||
    bundleRecord.artifactHashes.length !== 6 ||
    !HEX.test(String(bundleRecord.bundleHash))
  )
    throw new Error("R5 common artifact bundle schema is invalid");
  const artifactHashes = bundleRecord.artifactHashes;
  if (
    artifactHashes.some(
      (value) =>
        typeof value !== "string" ||
        !/^(computer_lead|math_lead)\/[^/]+\/(exercise|understanding|handoff)\.r[1-9][0-9]*\.json:[a-f0-9]{64}$/.test(
          value,
        ),
    ) ||
    new Set(artifactHashes).size !== artifactHashes.length
  )
    throw new Error("R5 common artifact bundle must contain six unique role artifacts");
  if (canonicalize(artifactHashes) !== canonicalize([...artifactHashes].sort()))
    throw new Error("R5 common artifact bundle artifactHashes must be sorted");
  const expectedBundleHash = sha256(
    canonicalize({
      schemaVersion: bundleRecord.schemaVersion,
      artifactHashes,
      status: bundleRecord.status,
    }),
  );
  if (bundleRecord.bundleHash !== expectedBundleHash)
    throw new Error("R5 common artifact bundle hash mismatch");
  const bundleFileHash = sha256(bundleFile.bytes);
  const [first, second] = result.selected;
  if (
    canonicalize(sortedArtifacts(first.receipt.artifacts)) !==
    canonicalize(sortedArtifacts(second.receipt.artifacts))
  )
    throw new Error("R5 receipts do not bind the same artifact set");
  for (const { receipt } of result.selected) {
    const bundleArtifact = receipt.artifacts.find(
      (artifact) => artifact.logicalId === "r5-artifact-bundle.json",
    );
    if (!bundleArtifact || bundleArtifact.sha256 !== bundleFileHash)
      throw new Error(`R5 ${receipt.role} receipt does not bind the common bundle bytes`);
  }
  return result;
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
