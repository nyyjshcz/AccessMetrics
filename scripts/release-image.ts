import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { args, git, writeJsonAtomic } from "./release-utils";

const options = args();
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm release:image -- --candidate <sha> --release-tag <tag> --publication-db <absolute-db> --expected-publication-revision <n+1> --validation-attestation <absolute-json> --out <absolute-json> [--image-repository <name>]",
  );
  process.exit(0);
}

const errors: string[] = [];
const required = [
  "candidate",
  "release-tag",
  "publication-db",
  "expected-publication-revision",
  "validation-attestation",
  "out",
];
for (const name of required) if (!options[name]) errors.push(`缺少 --${name}`);
const candidate = options.candidate ?? "";
const releaseTag = options["release-tag"] ?? "";
const isCommit = /^[a-f0-9]{40}$/.test(candidate);
if (!isCommit) errors.push("candidate 必须是完整 commit SHA");
if (!/^[A-Za-z0-9._-]+$/.test(releaseTag)) errors.push("release-tag 含有不安全字符");
const absolute = (name: string) => {
  const value = options[name];
  if (!value || !path.isAbsolute(value)) {
    errors.push(`--${name} 必须是绝对路径`);
    return null;
  }
  return path.resolve(value);
};
const dbPath = absolute("publication-db");
const validationPath = absolute("validation-attestation");
const outputPath = absolute("out");
const expectedRevision = Number(options["expected-publication-revision"]);
if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  errors.push("expected-publication-revision 必须是正整数");
const commandResults: Array<{
  name: string;
  exitCode: number;
  stdoutSha256: string;
  stderrSha256: string;
}> = [];
const startedAt = new Date().toISOString();
let validation: any = null;
let validationAttestationHash = "";
let imageDigest: string | null = null;
let embeddedProvenanceHash: string | null = null;
let ociLabelCommit: string | null = null;
let tagObject: string | null = null;
let tagMessageHash: string | null = null;
let verifiedTreeHash: string | null = null;
let buildContextTreeHash: string | null = null;
let rcCommit: string | null = null;
let finalExportId: string | null = null;
let finalManifestHash: string | null = null;
let db: Database.Database | undefined;
let tagCreated = false;

function addError(message: string) {
  if (!errors.includes(message)) errors.push(message);
}

function run(name: string, command: string, commandArgs: string[], cwd: string) {
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

function tagDetails() {
  const object = git("rev-parse", `${releaseTag}^{tag}`);
  const message = git("cat-file", "-p", object);
  return { object, messageHash: sha256(message) };
}

function buildInCleanClone() {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-image-"));
  const image = `${options["image-repository"] ?? "accesscheck-lishui"}:${candidate}`;
  try {
    if (
      run(
        "image-clean-clone",
        "git",
        ["clone", "--no-local", "--no-checkout", process.cwd(), clone],
        process.cwd(),
      ).exitCode !== 0
    )
      return;
    if (run("image-checkout", "git", ["checkout", "--detach", candidate], clone).exitCode !== 0)
      return;
    buildContextTreeHash = execFileSync("git", ["-C", clone, "rev-parse", "HEAD^{tree}"], {
      encoding: "utf8",
    }).trim();
    if (buildContextTreeHash !== verifiedTreeHash)
      addError("build context tree hash 与 validation 不一致");
    const buildArgs = [
      "build",
      "--file",
      "Dockerfile",
      "--tag",
      image,
      "--build-arg",
      `ACCESSCHECK_FINAL_CANDIDATE=${candidate}`,
      "--build-arg",
      `ACCESSCHECK_RC_COMMIT=${rcCommit ?? ""}`,
      "--build-arg",
      `ACCESSCHECK_VERIFIED_TREE_HASH=${verifiedTreeHash ?? ""}`,
      "--build-arg",
      `ACCESSCHECK_FULL_GATE_BUNDLE_HASH=${validation.fullGateBundleHash}`,
      "--build-arg",
      `ACCESSCHECK_VALIDATION_ATTESTATION_HASH=${validationAttestationHash}`,
      "--build-arg",
      `ACCESSCHECK_BUILDER_VERSION=release-image-v2`,
      ".",
    ];
    if (run("docker-build", "docker", buildArgs, clone).exitCode !== 0) return;
    const inspect = run(
      "docker-inspect",
      "docker",
      [
        "image",
        "inspect",
        image,
        "--format",
        '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}',
      ],
      clone,
    );
    if (inspect.exitCode !== 0) return;
    const [id, label] = inspect.stdout.trim().split("|");
    if (!/^sha256:[a-f0-9]{64}$/.test(id ?? ""))
      addError("Docker image ID 不是不可变 sha256 digest");
    imageDigest = id ?? null;
    ociLabelCommit = label ?? null;
    if (ociLabelCommit !== candidate) addError("OCI revision label 与 finalCandidate 不一致");
    const provenance = run(
      "docker-provenance",
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        image,
        "node",
        "-e",
        "process.stdout.write(require('fs').readFileSync('/app/build-provenance.json','utf8'))",
      ],
      clone,
    );
    if (provenance.exitCode !== 0) return;
    const provenanceBytes = Buffer.from(provenance.stdout);
    const value = JSON.parse(provenance.stdout) as Record<string, unknown>;
    if (
      value.finalCandidate !== candidate ||
      value.rcCommit !== rcCommit ||
      value.verifiedTreeHash !== verifiedTreeHash
    )
      addError("镜像内嵌 provenance 与 candidate/tree 不一致");
    if (
      value.fullGateBundleHash !== validation.fullGateBundleHash ||
      value.validationAttestationHash !== validationAttestationHash
    )
      addError("镜像内嵌 provenance 与 gate/validation hash 不一致");
    embeddedProvenanceHash = sha256(provenanceBytes);
    run("docker-remove", "docker", ["image", "rm", image], clone);
  } finally {
    fs.rmSync(clone, { recursive: true, force: true });
  }
}

try {
  if (errors.length === 0) {
    if (git("rev-parse", "HEAD") !== candidate) addError("当前 HEAD 必须准确等于 candidate");
    if (git("status", "--porcelain")) addError("工作树必须干净");
    verifiedTreeHash = git("rev-parse", `${candidate}^{tree}`);
    if (!validationPath || !fs.existsSync(validationPath))
      addError("validation attestation 不存在");
    else {
      validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));
      validationAttestationHash = sha256(fs.readFileSync(validationPath));
      if (validation.status !== "passed") addError("validation attestation 未通过");
      if (validation.finalCandidate !== candidate) addError("validation candidate 不一致");
      if (validation.verifiedTreeHash !== verifiedTreeHash) addError("validation tree hash 不一致");
      if (!/^[a-f0-9]{64}$/.test(validation.fullGateBundleHash ?? ""))
        addError("validation 缺少 full gate hash");
      rcCommit = validation.rcCommit ?? null;
      finalExportId = validation.finalExportId ?? null;
      finalManifestHash = validation.finalManifestHash ?? null;
    }
    if (dbPath && fs.existsSync(dbPath) && finalExportId) {
      db = new Database(dbPath);
      const row = db.prepare("SELECT * FROM study_exports WHERE id=?").get(finalExportId) as any;
      if (!row) addError("publication export 不存在");
      else if (
        row.publication_status !== "release_validating" ||
        row.publication_revision !== expectedRevision
      )
        addError("publication export 未处于 expected release_validating revision");
    } else addError("publication database/export 信息缺失");
    if (errors.length === 0) buildInCleanClone();
    if (errors.length === 0) {
      const existingTag = (() => {
        try {
          return git("rev-parse", `${releaseTag}^{commit}`);
        } catch {
          return null;
        }
      })();
      if (existingTag && existingTag !== candidate) addError("release tag 已存在且指向其他 commit");
      if (!existingTag) {
        const message = `AccessCheck ${releaseTag}\nfinalCandidate=${candidate}\nrcCommit=${rcCommit}\nfinalExportId=${finalExportId}\nfullGateBundleHash=${validation.fullGateBundleHash}\nvalidationAttestationHash=${validationAttestationHash}\nimageDigest=${imageDigest}`;
        execFileSync("git", ["tag", "-a", releaseTag, candidate, "-m", message], {
          encoding: "utf8",
        });
        tagCreated = true;
      }
      const details = tagDetails();
      tagObject = details.object;
      tagMessageHash = details.messageHash;
    }
  }
} catch (error) {
  addError(error instanceof Error ? error.message : String(error));
}

const base: any = {
  schemaVersion: "release-build-attestation-v1",
  status: errors.length === 0 ? "passed" : "blocked",
  releaseTag,
  tagObject,
  tagMessageHash,
  finalCandidate: candidate,
  rcCommit,
  verifiedTreeHash,
  buildContextTreeHash,
  publicationRevisionLocked: Number.isInteger(expectedRevision) ? expectedRevision : null,
  publicationRevisionReady: errors.length === 0 ? expectedRevision + 1 : null,
  fullGateBundleHash: validation?.fullGateBundleHash ?? null,
  validationAttestationHash: validationAttestationHash || null,
  finalExportId,
  finalManifestHash,
  imageDigest,
  ociLabelCommit,
  embeddedProvenanceHash,
  builtAt: new Date().toISOString(),
  builderVersion: "release-image-v2",
};
const attestation = { ...base, attestationHash: sha256(canonicalize(base)) };
if (errors.length === 0 && db && finalExportId) {
  try {
    db.exec("BEGIN IMMEDIATE");
    const result = db
      .prepare(
        "UPDATE study_exports SET publication_status='release_ready', publication_revision=publication_revision+1, release_finished_at=?, publication_commit=?, publication_gate_bundle_hash=?, validation_attestation_hash=?, publication_attestation_hash=?, build_attestation_hash=? WHERE id=? AND publication_status='release_validating' AND publication_revision=?",
      )
      .run(
        new Date().toISOString(),
        candidate,
        validation.fullGateBundleHash,
        validationAttestationHash,
        attestation.attestationHash,
        attestation.attestationHash,
        finalExportId,
        expectedRevision,
      );
    if (result.changes !== 1) {
      db.exec("ROLLBACK");
      addError("release_ready CAS 冲突");
    } else db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The original error is the useful diagnostic.
    }
    addError(error instanceof Error ? error.message : String(error));
  }
}
if (errors.length > 0 && attestation.status === "passed") {
  attestation.status = "blocked";
  attestation.publicationRevisionReady = null;
  attestation.attestationHash = sha256(
    canonicalize(
      Object.fromEntries(Object.entries(attestation).filter(([key]) => key !== "attestationHash")),
    ),
  );
}
if (outputPath) writeJsonAtomic(outputPath, attestation);
if (db) db.close();
if (errors.length) {
  console.error(JSON.stringify({ status: "blocked", errors, tagCreated }, null, 2));
  process.exitCode = 2;
} else console.log(JSON.stringify(attestation, null, 2));
