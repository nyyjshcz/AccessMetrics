import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { listEvidenceFiles, listGateFiles, verifyApprovedGate } from "./gate-utils";
import { args, git, writeJsonAtomic } from "./release-utils";

const options = args();
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm release:verify -- --candidate <sha> --rc-commit <sha> --publication-db <absolute-db> --expected-publication-revision <n> --final-export-path <absolute-dir> --expected-manifest-sha256 <sha256> --gate-evidence-path <absolute-dir> --expected-r4-evidence-bundle-sha256 <sha256> --expected-full-gate-bundle-sha256 <sha256> --out <absolute-attestation>",
  );
  process.exit(0);
}

const required = [
  "candidate",
  "rc-commit",
  "publication-db",
  "expected-publication-revision",
  "final-export-path",
  "expected-manifest-sha256",
  "gate-evidence-path",
  "expected-r4-evidence-bundle-sha256",
  "expected-full-gate-bundle-sha256",
  "out",
];
const errors: string[] = [];
const commandResults: Array<{
  name: string;
  exitCode: number;
  stdoutSha256: string;
  stderrSha256: string;
}> = [];
const expectedWhitelist = ["docs/gate-attestation-index.json"];
const startedAt = new Date().toISOString();
let candidate = options.candidate ?? "";
let rcCommit = options["rc-commit"] ?? "";
let verifiedTreeHash: string | null = null;
let sourceExportId: string | null = null;
let sourceManifestHash: string | null = null;
let finalExportId: string | null = null;
let finalManifestHash: string | null = null;
let publicationRevisionBefore: number | null = null;
let publicationRevisionLocked: number | null = null;
let db: Database.Database | undefined;
let releaseLocked = false;

function addError(message: string) {
  if (!errors.includes(message)) errors.push(message);
}

function isSha(value: unknown, length: 40 | 64) {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}

function absoluteOption(name: string) {
  const value = options[name];
  if (!value || !path.isAbsolute(value)) {
    addError(`--${name} 必须是绝对路径`);
    return null;
  }
  return path.resolve(value);
}

function runCommand(name: string, command: string, commandArgs: string[], cwd: string) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
    shell: process.platform === "win32",
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? (result.error ? String(result.error) : "");
  const exitCode = typeof result.status === "number" ? result.status : 1;
  commandResults.push({
    name,
    exitCode,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
  });
  if (exitCode !== 0) addError(`${name} failed${stderr ? `: ${stderr.slice(0, 300)}` : ""}`);
  return { exitCode, stdout, stderr };
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertReadOnly(directory: string, label: string) {
  try {
    fs.accessSync(directory, fs.constants.W_OK);
    addError(`${label} 必须以只读目录提供，当前仍可写`);
  } catch {
    // access(W_OK) failing is the expected read-only result.
  }
}

function verifyManifest(exportRoot: string) {
  const manifestPath = path.join(exportRoot, "manifest.json");
  const digestPath = path.join(exportRoot, "manifest.sha256");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(digestPath)) {
    addError("final export 必须同时包含 manifest.json 和 manifest.sha256");
    return;
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const hash = sha256(manifestBytes);
  finalManifestHash = hash;
  if (hash !== options["expected-manifest-sha256"])
    addError("final manifest hash 与命令参数不一致");
  if (fs.readFileSync(digestPath, "utf8").trim() !== hash)
    addError("manifest.sha256 与 manifest.json 不一致");
  let manifest: any;
  try {
    manifest = readJson(manifestPath);
  } catch {
    addError("manifest.json 不是有效 JSON");
    return;
  }
  finalExportId = typeof manifest.exportId === "string" ? manifest.exportId : null;
  sourceExportId = typeof manifest.sourceExportId === "string" ? manifest.sourceExportId : null;
  sourceManifestHash =
    typeof manifest.sourceManifestHash === "string" ? manifest.sourceManifestHash : null;
  if (!finalExportId) addError("final manifest 缺少 exportId");
  if (!Array.isArray(manifest.files)) {
    addError("final manifest 缺少 files");
    return;
  }
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || path.isAbsolute(file.path)) {
      addError("manifest 含有不安全文件路径");
      continue;
    }
    const normalized = file.path.replaceAll("\\", "/");
    if (normalized.split("/").some((part: string) => part === ".." || part === ".")) {
      addError(`manifest 含有路径越界: ${normalized}`);
      continue;
    }
    const absolute = path.join(exportRoot, normalized);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      addError(`manifest 引用文件不存在: ${normalized}`);
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    if (typeof file.size === "number" && file.size !== bytes.length)
      addError(`manifest 文件大小不一致: ${normalized}`);
    if (typeof file.sha256 === "string" && file.sha256 !== sha256(bytes))
      addError(`manifest 文件 hash 不一致: ${normalized}`);
  }
}

function verifyGateEvidence(evidenceRoot: string) {
  if (!fs.existsSync(evidenceRoot)) {
    addError("gate evidence root 不存在");
    return;
  }
  const r4Files = listGateFiles(evidenceRoot, ["R1", "R2", "R3", "R4"]);
  const actualR4 = sha256(
    canonicalize(r4Files.map((file) => ({ path: file.path, sha256: file.sha256 }))),
  );
  if (actualR4 !== options["expected-r4-evidence-bundle-sha256"])
    addError("R1-R4 evidence bundle hash 不一致");
  for (const gate of ["R1", "R2", "R3", "R4"] as const)
    verifyApprovedGate(evidenceRoot, gate, options["publication-db"]);
  const r5 = verifyApprovedGate(evidenceRoot, "R5", options["publication-db"]);
  for (const { receipt } of r5.selected)
    if (receipt.boundCommit !== rcCommit) addError("R5 receipt 未绑定准确 rcCommit");
  const bundleFile = r5.files.find(
    (file) => path.basename(file.path) === "r5-artifact-bundle.json",
  );
  if (!bundleFile) {
    addError("R5 缺少 r5-artifact-bundle.json");
    return;
  }
  let bundle: any;
  try {
    bundle = JSON.parse(bundleFile.bytes.toString("utf8"));
  } catch {
    addError("R5 artifact bundle 不是有效 JSON");
    return;
  }
  if (bundle.schemaVersion !== "r5-artifact-bundle-v1" || bundle.status !== "verified")
    addError("R5 artifact bundle 未通过服务端验证");
  const expectedBundleHash = sha256(
    canonicalize({
      schemaVersion: bundle.schemaVersion,
      artifactHashes: bundle.artifactHashes,
      status: bundle.status,
    }),
  );
  if (bundle.bundleHash !== expectedBundleHash) addError("R5 artifact bundle hash 不一致");
  const r5Files = listEvidenceFiles(path.join(evidenceRoot, "R5")).map((file) => ({
    path: file.path,
    sha256: file.sha256,
  }));
  const full = sha256(
    canonicalize({
      r4: options["expected-r4-evidence-bundle-sha256"],
      r5: r5Files,
      r5ArtifactBundleHash: bundle.bundleHash,
      r5Receipts: r5.selected.map(({ receipt }) => receipt.receiptHash).sort(),
    }),
  );
  if (full !== options["expected-full-gate-bundle-sha256"])
    addError("R1-R5 full gate bundle hash 不一致");
}

function verifyGateIndex() {
  let index: any;
  try {
    index = JSON.parse(
      execFileSync("git", ["show", `${candidate}:docs/gate-attestation-index.json`], {
        encoding: "utf8",
      }),
    );
  } catch {
    addError("candidate 缺少可读取的 gate-attestation-index.json");
    return;
  }
  if (index.throughGate !== "R5" || index.r5Status !== "passed") addError("candidate 尚未 seal R5");
  if (index.rcCommit !== rcCommit) addError("candidate gate index 的 rcCommit 不一致");
  if (index.r4EvidenceBundleHash !== options["expected-r4-evidence-bundle-sha256"])
    addError("candidate gate index 的 R4 hash 不一致");
  if (index.fullGateBundleHash !== options["expected-full-gate-bundle-sha256"])
    addError("candidate gate index 的 full hash 不一致");
}

function lockPublication(dbPath: string) {
  publicationRevisionBefore = Number(options["expected-publication-revision"]);
  publicationRevisionLocked = publicationRevisionBefore + 1;
  db = new Database(dbPath);
  db.pragma("busy_timeout = 5000");
  db.exec("BEGIN IMMEDIATE");
  const result = db
    .prepare(
      "UPDATE study_exports SET publication_status='release_validating', publication_revision=publication_revision+1, release_started_at=?, publication_error=NULL WHERE id=? AND status='verified' AND is_current=1 AND publication_status IN ('unpublished','withdrawn') AND publication_revision=?",
    )
    .run(new Date().toISOString(), finalExportId, publicationRevisionBefore);
  if (result.changes !== 1) {
    db.exec("ROLLBACK");
    addError("publication CAS 未匹配 verified/current/unpublished(or withdrawn) export");
    return;
  }
  db.exec("COMMIT");
  releaseLocked = true;
}

function markValidationFailure() {
  if (!db || !releaseLocked || !finalExportId || publicationRevisionLocked === null) return;
  try {
    db.prepare(
      "UPDATE study_exports SET publication_status='unpublished', publication_revision=publication_revision+1, release_finished_at=?, publication_error=? WHERE id=? AND publication_status='release_validating' AND publication_revision=?",
    ).run(
      new Date().toISOString(),
      errors.join("; ").slice(0, 500),
      finalExportId,
      publicationRevisionLocked,
    );
  } catch {
    // A concurrent writer must never be rolled back to an older revision.
  }
}

function gitIn(directory: string, ...params: string[]) {
  return execFileSync("git", ["-C", directory, ...params], { encoding: "utf8" }).trim();
}

function runCleanClone() {
  const source = process.cwd();
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-release-"));
  try {
    if (
      runCommand(
        "clean-clone",
        "git",
        ["clone", "--no-local", "--no-checkout", source, clone],
        source,
      ).exitCode !== 0
    )
      return;
    if (
      runCommand("clean-clone-checkout", "git", ["checkout", "--detach", candidate], clone)
        .exitCode !== 0
    )
      return;
    if (gitIn(clone, "rev-parse", "HEAD^{tree}") !== verifiedTreeHash)
      addError("clean clone tree hash 与 validation 不一致");
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    if (
      runCommand("clean-clone-install", pnpm, ["install", "--frozen-lockfile"], clone).exitCode !==
      0
    )
      return;
    if (
      runCommand(
        "clean-clone-deliverables",
        pnpm,
        [
          "deliverables:verify",
          "--",
          "--final-export-path",
          options["final-export-path"],
          "--expected-manifest-sha256",
          options["expected-manifest-sha256"],
          "--report-data",
          path.join(clone, "analysis", "outputs", "report-data.json"),
          "--reports-root",
          path.join(clone, "analysis", "outputs"),
          "--gate-evidence-path",
          options["gate-evidence-path"],
          "--publication-db",
          options["publication-db"],
          "--expected-r4-evidence-bundle-sha256",
          options["expected-r4-evidence-bundle-sha256"],
          "--expected-full-gate-bundle-sha256",
          options["expected-full-gate-bundle-sha256"],
        ],
        clone,
      ).exitCode !== 0
    )
      return;
    runCommand("clean-clone-test-all", pnpm, ["test:all"], clone);
    runCommand("clean-clone-build", pnpm, ["build"], clone);
    runCommand(
      "clean-clone-compose-config",
      "docker",
      ["compose", "-f", "compose.yaml", "config", "--quiet"],
      clone,
    );
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
  }
}

for (const name of required) if (!options[name]) addError(`缺少 --${name}`);
if (!isSha(candidate, 40)) addError("candidate 必须是完整 40 位 commit SHA");
if (!isSha(rcCommit, 40)) addError("rc-commit 必须是完整 40 位 commit SHA");
const publicationDb = absoluteOption("publication-db");
const finalExportPath = absoluteOption("final-export-path");
const evidencePath = absoluteOption("gate-evidence-path");
const outputPath = absoluteOption("out");
const expectedRevision = Number(options["expected-publication-revision"]);
if (!Number.isInteger(expectedRevision) || expectedRevision < 0)
  addError("expected-publication-revision 必须是非负整数");
if (!isSha(options["expected-manifest-sha256"], 64)) addError("expected manifest hash 无效");
if (!isSha(options["expected-r4-evidence-bundle-sha256"], 64)) addError("expected R4 hash 无效");
if (!isSha(options["expected-full-gate-bundle-sha256"], 64)) addError("expected full hash 无效");

try {
  if (errors.length === 0) {
    const head = git("rev-parse", "HEAD");
    if (head !== candidate) addError("当前 HEAD 必须准确等于 finalCandidate");
    if (git("status", "--porcelain")) addError("工作树必须干净");
    const resolvedCandidate = git("rev-parse", candidate);
    const resolvedRc = git("rev-parse", rcCommit);
    if (resolvedCandidate !== candidate || resolvedRc !== rcCommit)
      addError("candidate/rc-commit 必须是当前仓库可解析的完整 SHA");
    const parents = git("rev-list", "--parents", "-n", "1", candidate).split(/\s+/);
    if (parents.length !== 2 || parents[1] !== rcCommit)
      addError("finalCandidate 必须只有一个 parent 且准确为 rcCommit");
    const changed = git("diff", "--name-only", `${rcCommit}..${candidate}`)
      .split(/\r?\n/)
      .filter(Boolean)
      .sort();
    if (
      changed.length !== expectedWhitelist.length ||
      changed.some((file, index) => file !== expectedWhitelist[index])
    )
      addError("finalCandidate 与 rcCommit 的差异必须精确为两个 seal 白名单文件");
    verifiedTreeHash = git("rev-parse", `${candidate}^{tree}`);
    verifyGateIndex();
    if (finalExportPath && fs.existsSync(finalExportPath)) {
      assertReadOnly(finalExportPath, "final export");
      verifyManifest(finalExportPath);
    } else addError("final export 目录不存在");
    if (evidencePath && fs.existsSync(evidencePath)) {
      assertReadOnly(evidencePath, "gate evidence");
      verifyGateEvidence(evidencePath);
    }
    if (!finalExportId) addError("无法从 final manifest 取得 exportId");
    if (publicationDb && fs.existsSync(publicationDb) && finalExportId)
      lockPublication(publicationDb);
    else addError("publication database 不存在");
    if (errors.length === 0 && releaseLocked) runCleanClone();
  }
} catch (error) {
  addError(error instanceof Error ? error.message : String(error));
}

if (errors.length > 0) markValidationFailure();
const report: any = {
  schemaVersion: "release-validation-attestation-v1",
  status: errors.length === 0 ? "passed" : "failed",
  finalCandidate: isSha(candidate, 40) ? candidate : null,
  rcCommit: isSha(rcCommit, 40) ? rcCommit : null,
  publicationRevisionBefore,
  publicationRevisionLocked,
  verifiedTreeHash,
  r4EvidenceBundleHash: options["expected-r4-evidence-bundle-sha256"] ?? null,
  fullGateBundleHash: options["expected-full-gate-bundle-sha256"] ?? null,
  sourceExportId,
  sourceManifestHash,
  finalExportId,
  finalManifestHash,
  commandResults,
  startedAt,
  completedAt: new Date().toISOString(),
  verifierVersion: "release-verifier-v2",
  errors,
  attestationHash: "",
};
const { attestationHash: _ignored, ...withoutHash } = report;
report.attestationHash = sha256(canonicalize(withoutHash));
if (outputPath) {
  const failedPath = errors.length ? `${outputPath}.failed-${Date.now()}.json` : outputPath;
  writeJsonAtomic(failedPath, report);
  if (errors.length) console.error(`validation failed; wrote ${failedPath}`);
}
db?.close();
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
