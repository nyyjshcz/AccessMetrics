import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { canonicalize, sha256 } from "../src/lib/canonical";
import { args, git } from "./release-utils";

const options = args();
if (process.argv.includes("--help")) {
  console.log(
    "usage: pnpm release:publish-check -- --tag <tag> --export-id <id> --publication-db <absolute-db> --private-evidence-root <absolute-dir> --expected-publication-revision <n> --build-attestation <absolute-json> --base-url <https-url>",
  );
  process.exit(0);
}

const errors: string[] = [];
const required = [
  "tag",
  "export-id",
  "publication-db",
  "private-evidence-root",
  "expected-publication-revision",
  "build-attestation",
  "base-url",
];
for (const name of required) if (!options[name]) errors.push(`缺少 --${name}`);
const absolute = (name: string) => {
  const value = options[name];
  if (!value || !path.isAbsolute(value)) {
    errors.push(`--${name} 必须是绝对路径`);
    return null;
  }
  return path.resolve(value);
};
const dbPath = absolute("publication-db");
const evidenceRoot = absolute("private-evidence-root");
const attestationPath = absolute("build-attestation");
const expectedRevision = Number(options["expected-publication-revision"]);
if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  errors.push("expected-publication-revision 必须是正整数");
let build: any = null;
let db: Database.Database | undefined;
let row: any;
const blockers = [...errors];

function blocker(message: string) {
  if (!blockers.includes(message)) blockers.push(message);
}

function findApproval() {
  if (!evidenceRoot) return null;
  const directory = path.join(evidenceRoot, "publication-approvals", options["export-id"] ?? "");
  if (!fs.existsSync(directory)) return null;
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(directory, file));
  for (const file of files) {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value.decision === "approved" && value.licenseDecision === "authorized_public")
        return value;
    } catch {
      // Ignore unrelated or corrupted historical approvals; they cannot unlock publication.
    }
  }
  return null;
}

async function main() {
  if (errors.length === 0) {
    try {
      if (!attestationPath || !fs.existsSync(attestationPath)) blocker("build attestation 不存在");
      else {
        const bytes = fs.readFileSync(attestationPath);
        build = JSON.parse(bytes.toString("utf8"));
        const attestationHash = sha256(
          canonicalize(
            Object.fromEntries(Object.entries(build).filter(([key]) => key !== "attestationHash")),
          ),
        );
        if (build.attestationHash !== attestationHash) blocker("build attestation 自哈希不一致");
        if (build.status !== "passed") blocker("build attestation 未通过");
        if (build.schemaVersion !== "release-build-attestation-v1")
          blocker("build attestation schema 不匹配");
        if (build.releaseTag !== options.tag) blocker("release tag mismatch");
        if (!/^[a-f0-9]{40}$/.test(build.finalCandidate ?? "")) blocker("缺少 finalCandidate");
        if (!/^sha256:[a-f0-9]{64}$/.test(build.imageDigest ?? ""))
          blocker("缺少不可变 image digest");
        if (build.verifiedTreeHash !== build.buildContextTreeHash)
          blocker("build tree hash 不一致");
      }
      if (!dbPath || !fs.existsSync(dbPath)) blocker("publication database 不存在");
      else {
        db = new Database(dbPath);
        row = db.prepare("SELECT * FROM study_exports WHERE id=?").get(options["export-id"]);
        if (!row) blocker("study export 不存在");
        else {
          if (row.kind !== "study_final" || row.status !== "verified" || row.is_current !== 1)
            blocker("study export 不是 verified/current study_final");
          if (row.publication_status !== "release_ready")
            blocker("publication 状态不是 release_ready");
          if (row.publication_revision !== expectedRevision) blocker("publication revision 不匹配");
          if (build) {
            if (row.publication_commit !== build.finalCandidate)
              blocker("DB publication_commit 与 build 不一致");
            if (row.publication_gate_bundle_hash !== build.fullGateBundleHash)
              blocker("DB fullGateBundleHash 与 build 不一致");
            if (row.validation_attestation_hash !== build.validationAttestationHash)
              blocker("DB validation attestation hash 与 build 不一致");
            if (
              (row.build_attestation_hash ?? row.publication_attestation_hash) !==
              sha256(fs.readFileSync(attestationPath!))
            )
              blocker("DB build attestation hash 与文件不一致");
          }
          if (!row.privacy_check_hash || !row.file_allowlist_hash || !row.publication_scope_hash)
            blocker("缺少隐私检查或 publication approval scope");
        }
      }
      if (build) {
        try {
          const taggedCommit = git("rev-parse", `${options.tag}^{commit}`);
          if (taggedCommit !== build.finalCandidate) blocker("不可变 tag 未指向 finalCandidate");
          const tagObject = git("rev-parse", `${options.tag}^{tag}`);
          if (build.tagObject !== tagObject) blocker("annotated tag object 与 build 不一致");
        } catch (error) {
          blocker(
            `release tag 校验失败: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const approval = findApproval();
      if (!approval) blocker("缺少 authorized_public + approved 的 publication approval");
      else if (row) {
        if (approval.exportId !== options["export-id"]) blocker("approval exportId 不一致");
        if (approval.manifestHash !== row.manifest_hash) blocker("approval manifest hash 不一致");
        if (approval.fileAllowlistHash !== row.file_allowlist_hash)
          blocker("approval file allowlist hash 不一致");
        if (approval.privacyCheckHash !== row.privacy_check_hash)
          blocker("approval privacy hash 不一致");
        const { approvalHash: _hash, ...withoutHash } = approval;
        if (approval.approvalHash !== sha256(canonicalize(withoutHash)))
          blocker("approval hash 不一致");
      }
      try {
        const base = new URL(options["base-url"]);
        if (base.protocol !== "https:") blocker("生产 publish-check 必须使用 HTTPS base URL");
        else {
          const response = await fetch(new URL("/api/meta/build", base));
          if (!response.ok) blocker(`GET /api/meta/build 返回 ${response.status}`);
          else {
            const meta = (await response.json()) as any;
            if (!build || meta.provenance?.finalCandidate !== build.finalCandidate)
              blocker("运行中服务 provenance 与 build 不一致");
            if (!build || meta.provenance?.fullGateBundleHash !== build.fullGateBundleHash)
              blocker("运行中服务 fullGateBundleHash 与 build 不一致");
          }
        }
      } catch (error) {
        blocker(
          `无法读取 /api/meta/build: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } catch (error) {
      blocker(error instanceof Error ? error.message : String(error));
    }
  }

  const result = {
    ready: blockers.length === 0,
    errors: blockers,
    checkedAt: new Date().toISOString(),
    ...(blockers.length === 0 && row && build
      ? {
          publish: {
            exportId: options["export-id"],
            expectedPublicationRevision: row.publication_revision,
            expectedFullGateBundleHash: build.fullGateBundleHash,
            expectedFinalCandidateCommit: build.finalCandidate,
            expectedPublicationAttestationHash:
              row.build_attestation_hash ?? row.publication_attestation_hash,
            publicationScopeHash: row.publication_scope_hash,
          },
        }
      : {}),
  };
  console.log(JSON.stringify(result, null, 2));
  db?.close();
  if (blockers.length) process.exitCode = 1;
}

void main();
