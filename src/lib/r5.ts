import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalize, sha256 } from "./canonical";
import { config } from "./config";
import { getDb, migrate, transaction } from "./db";
import { AppError } from "./errors";
import { id } from "./ids";
import { reviewerReauthMatches } from "./auth";

const EXERCISES = [
  "dependency-preflight",
  "fixture-scan",
  "worker-recovery",
  "export-manifest",
  "backup-restore",
  "publication-fail-closed",
] as const;
const TOPICS = [
  "ssrf",
  "axe-severity",
  "wcag-mapping",
  "scoring",
  "worker-lease",
  "manifest-traceability",
] as const;
const HANDOFF_ITEMS = ["handoff-a", "handoff-b", "handoff-c", "handoff-d", "handoff-e"] as const;
type Role = "computer_lead" | "math_lead";
const EXERCISE_CATALOG_FILE = path.join(
  process.cwd(),
  "docs",
  "owner-handoff",
  "r5-exercise-catalog.v1.json",
);
const INDEX_FILE = path.join(process.cwd(), "docs", "gate-attestation-index.json");
const FIXED_ENVIRONMENT = {
  runner: "r5-fixed-exercise-v1",
  node: process.version,
  packageManager: "pnpm@11.19.0",
  platform: process.platform,
  arch: process.arch,
};
const ENVIRONMENT_HASH = sha256(canonicalize(FIXED_ENVIRONMENT));
const EXERCISE_COMMANDS = EXERCISES.map((id) => ({
  id,
  commandId: `r5-fixed-${id}`,
  argv: ["scripts/r5-fixed-exercise.mjs", id] as const,
  cwd: ".",
  required: true,
}));

function fixedFileHash(file: string) {
  if (!fs.existsSync(file))
    throw new AppError("R5_INPUT_MISSING", `缺少 R5 固定文件: ${file}`, 409);
  return sha256(fs.readFileSync(file));
}

function exerciseCatalogHash() {
  return fixedFileHash(EXERCISE_CATALOG_FILE);
}

function r1R4IndexHash() {
  return fixedFileHash(INDEX_FILE);
}

function assertHash(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new AppError("INVALID_HASH", `${label} 必须是 SHA-256`, 422);
  return value;
}

function assertR1R4Index(value: unknown) {
  const supplied = assertHash(value, "r1R4IndexHash");
  const actual = r1R4IndexHash();
  if (supplied !== actual)
    throw new AppError("R5_INDEX_MISMATCH", "R1-R4 公开索引 hash 不匹配", 409);
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as Record<string, unknown>;
  if (index.throughGate !== "R4" || index.status !== "R4_INDEXED")
    throw new AppError("R1_R4_REQUIRED", "R1-R4 尚未完成并封存，R5 不能开始", 409);
  return actual;
}

function privateChild(...parts: string[]) {
  const root = path.resolve(config.privateEvidenceRoot);
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new AppError("R5_PATH_INVALID", "R5 工作目录必须位于私有证据根内", 500);
  return target;
}

function gitText(args: string[], cwd: string) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 120_000 }).trim();
}

function workspaceState(session: any) {
  const root = session.exercise_root as string | null;
  const expectedRoot = privateChild("r5", "workspaces", session.role, session.id);
  if (!root || !path.isAbsolute(root) || root !== expectedRoot || !fs.existsSync(root))
    throw new AppError("R5_EXERCISE_MISSING", "R5 隔离工作树不存在，不能继续", 409);
  const head = gitText(["rev-parse", "HEAD"], root);
  const status = gitText(["status", "--porcelain", "--untracked-files=all"], root);
  const tree = gitText(["rev-parse", "HEAD^{tree}"], root);
  if (head !== session.bound_commit || status !== "" || tree !== session.exercise_bound_tree_hash) {
    transaction((db) =>
      db
        .prepare("UPDATE r5_sessions SET exercise_status='failed',updated_at=? WHERE id=?")
        .run(now(), session.id),
    );
    throw new AppError("R5_EXERCISE_TREE_DIRTY", "R5 隔离工作树已漂移或不是 clean tree", 409);
  }
  return { root, head, tree };
}

function createCleanWorkspace(session: any) {
  ensureRoot();
  const root = privateChild("r5", "workspaces", session.role, session.id);
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(root), { recursive: true, mode: 0o700 });
  const repository = process.cwd();
  try {
    execFileSync("git", ["clone", "--no-hardlinks", "--local", repository, root], {
      cwd: repository,
      stdio: "pipe",
      timeout: 120_000,
    });
    gitText(["checkout", "--detach", session.bound_commit], root);
    const head = gitText(["rev-parse", "HEAD"], root);
    const status = gitText(["status", "--porcelain", "--untracked-files=all"], root);
    if (head !== session.bound_commit || status !== "")
      throw new Error("fresh clone is not clean or checked out at bound commit");
    const tree = gitText(["rev-parse", "HEAD^{tree}"], root);
    return { root, tree, head };
  } catch (error) {
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    throw new AppError(
      "R5_CLEAN_CLONE_FAILED",
      `R5 clean clone/checkout 失败: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
      409,
    );
  }
}

/**
 * The understanding check is deliberately server-scored.  Each topic has five
 * fixed, observable key points; a point is awarded only when every token in its
 * group is present in the submitted explanation.  The rubric is part of the
 * question-set hash, so changing it creates a new R5 question set instead of
 * silently changing the meaning of an existing receipt.
 */
const R5_RUBRIC_VERSION = "r5-understanding-rubric-2026-08-22";
const R5_TOPIC_RUBRIC = {
  ssrf: [
    ["url", "dns"],
    ["重定向", "子资源"],
    ["私网", "localhost", "metadata"],
    ["凭据", "危险协议"],
    ["fixture", "白名单"],
  ],
  "axe-severity": [
    ["passes", "violations", "incomplete", "inapplicable"],
    ["保存"],
    ["incomplete", "不确定失败"],
    ["violation", "失败"],
    ["inapplicable", "不适用"],
  ],
  "wcag-mapping": [
    ["tags", "解析"],
    ["冻结", "成功标准"],
    ["原则", "等级", "目录"],
    ["未知", "不猜"],
    ["4.1.1", "移除", "不评分"],
  ],
  scoring: [
    ["整数", "分子", "分母"],
    ["node impact", "rule impact"],
    ["回退"],
    ["多原则", "一次"],
    ["half-up", "一位小数"],
  ],
  "worker-lease": [
    ["queued", "leased", "running", "terminal"],
    ["heartbeat", "lease", "过期", "恢复"],
    ["唯一键", "不重复"],
    ["取消", "部分失败", "事实"],
    ["崩溃", "重启"],
  ],
  "manifest-traceability": [
    ["export-id"],
    ["manifest", "hash"],
    ["run", "page", "rule", "node"],
    ["报告", "hash"],
    ["source", "final", "覆盖"],
  ],
} as const;

const QUESTION_SET_HASH = sha256(
  canonicalize({ version: R5_RUBRIC_VERSION, topics: TOPICS, rubric: R5_TOPIC_RUBRIC }),
);

function containsToken(answer: string, token: string) {
  return answer.toLocaleLowerCase("zh-CN").includes(token.toLocaleLowerCase("zh-CN"));
}

function scoreTopic(topic: (typeof TOPICS)[number], answer: string) {
  const points = R5_TOPIC_RUBRIC[topic].map((group) =>
    group.every((token) => containsToken(answer, token)),
  );
  const score = Math.round((points.filter(Boolean).length / points.length) * 100);
  return { score, points, criticalPassed: points.every(Boolean) };
}

function now() {
  return new Date().toISOString();
}

function assertExact(body: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length)
    throw new AppError("UNKNOWN_FIELD", `R5 请求包含未定义字段: ${unknown.join(",")}`, 400);
}

function roleFromSession(role: string): Role {
  if (role === "computer_reviewer") return "computer_lead";
  if (role === "math_reviewer") return "math_lead";
  throw new AppError("FORBIDDEN", "只有 reviewer 可以完成 R5", 403);
}

function fullCommit(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value))
    throw new AppError("INVALID_COMMIT", "R5 必须绑定完整 40 位 rcCommit SHA", 422);
  return value;
}

function ensureRoot() {
  fs.mkdirSync(config.privateEvidenceRoot, { recursive: true, mode: 0o700 });
  recoverR5Artifacts();
}

function bundlePath() {
  return path.join(config.privateEvidenceRoot, "gates", "R5", "r5-artifact-bundle.json");
}

function canonicalBundlePath(bundleHash: string) {
  return path.join(config.privateEvidenceRoot, "gates", "R5", "bundles", `${bundleHash}.json`);
}

function invalidateBundle(boundCommit: string) {
  const target = bundlePath();
  let bundleHashes: string[] = [];
  try {
    bundleHashes = (
      getDb()
        .prepare(
          "SELECT bundle_hash FROM r5_artifact_bundles WHERE rc_commit=? AND status<>'invalidated'",
        )
        .all(boundCommit) as Array<{ bundle_hash: string }>
    ).map((row) => row.bundle_hash);
  } catch {
    // Compatibility databases before migration 024 have no normalized bundle table.
  }
  for (const hash of bundleHashes) {
    const file = canonicalBundlePath(hash);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (fs.existsSync(target)) fs.unlinkSync(target);
  transaction((db) => {
    db.prepare(
      "UPDATE r5_sessions SET status='started',finalized_at=NULL,updated_at=? WHERE bound_commit=?",
    ).run(now(), boundCommit);
    db.prepare(
      "UPDATE r5_artifact_bundles SET status='invalidated' WHERE rc_commit=? AND status<>'invalidated'",
    ).run(boundCommit);
    db.prepare(
      "UPDATE human_gate_evidence SET is_current=0 WHERE gate_id='R5' AND bound_commit=? AND is_current=1",
    ).run(boundCommit);
  });
}

function sessionFor(role: Role, boundCommit: string) {
  migrate();
  const existing = getDb()
    .prepare("SELECT * FROM r5_sessions WHERE role=? AND bound_commit=?")
    .get(role, boundCommit) as any;
  if (existing) return existing;
  const session = {
    id: id("r5"),
    role,
    bound_commit: boundCommit,
    status: "started",
    created_at: now(),
    updated_at: now(),
  };
  getDb()
    .prepare(
      "INSERT INTO r5_sessions(id,role,bound_commit,status,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      session.id,
      session.role,
      session.bound_commit,
      session.status,
      session.created_at,
      session.updated_at,
    );
  return getDb().prepare("SELECT * FROM r5_sessions WHERE id=?").get(session.id) as any;
}

function r5ArtifactRevision(session: any, kind: "exercise" | "understanding" | "handoff") {
  const value = Number(session[`${kind}_revision`]);
  const hasPrevious = Boolean(session[`${kind}_hash`]);
  if (hasPrevious) return Number.isInteger(value) && value >= 0 ? value + 1 : 1;
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function artifactPathColumn(kind: "exercise" | "understanding" | "handoff") {
  return `${kind}_artifact_path`;
}

function safePrivateRelative(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === "..")
  )
    throw new AppError("R5_PATH_INVALID", "R5 artifact 路径不安全", 500);
  return privateChild(...normalized.split("/"));
}

function normalizedOwnerMetadata(
  session: any,
  kind: "exercise" | "understanding" | "handoff",
  value: any,
) {
  const indexHash = value?.r1R4IndexHash ?? session.exercise_index_hash;
  const catalogHash =
    value?.exerciseCatalogHash ??
    value?.handoffCatalogHash ??
    value?.questionSetHash ??
    session.exercise_catalog_hash;
  if (
    typeof indexHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(indexHash) ||
    typeof catalogHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(catalogHash)
  )
    return null;
  return {
    indexHash,
    catalogHash,
    boundTreeHash:
      typeof (value?.boundTreeHash ?? session.exercise_bound_tree_hash) === "string"
        ? (value?.boundTreeHash ?? session.exercise_bound_tree_hash)
        : null,
  };
}

function persistNormalizedOwnerArtifact(
  db: any,
  session: any,
  kind: "exercise" | "understanding" | "handoff",
  value: any,
  bytes: string,
  hash: string,
  revision: number,
) {
  const metadata = normalizedOwnerMetadata(session, kind, value);
  if (!metadata) return null;
  const previous = db
    .prepare(
      "SELECT id FROM r5_owner_artifacts WHERE artifact_type=? AND role=? AND is_current=1 ORDER BY revision DESC LIMIT 1",
    )
    .get(kind, session.role) as { id: string } | undefined;
  if (previous)
    db.prepare("UPDATE r5_owner_artifacts SET is_current=0,status='invalidated' WHERE id=?").run(
      previous.id,
    );
  const artifactId = id("r5-owner-artifact");
  db.prepare(
    "INSERT INTO r5_owner_artifacts(id,artifact_type,role,bound_rc_commit,bound_tree_hash,r1_r4_index_hash,catalog_hash,status,payload_json,artifact_hash,revision,supersedes_artifact_id,is_current,created_at,finalized_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    artifactId,
    kind,
    session.role,
    session.bound_commit,
    metadata.boundTreeHash,
    metadata.indexHash,
    metadata.catalogHash,
    "draft",
    bytes,
    hash,
    revision,
    previous?.id ?? null,
    1,
    now(),
    null,
  );
  if (kind === "exercise" && Array.isArray(value?.steps)) {
    for (const step of value.steps) {
      if (!step || typeof step !== "object") continue;
      const stdoutHash = typeof step.stdoutSha256 === "string" ? step.stdoutSha256 : null;
      const stderrHash = typeof step.stderrSha256 === "string" ? step.stderrSha256 : null;
      const outputHash = stdoutHash && stderrHash ? sha256(`${stdoutHash}:${stderrHash}`) : null;
      db.prepare(
        "INSERT INTO r5_exercise_steps(artifact_id,step_id,command_id,status,exit_code,output_sha256,stdout_sha256,stderr_sha256,observation,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(
        artifactId,
        String(step.id),
        String(step.commandId ?? ""),
        step.passed === true ? "passed" : "failed",
        Number.isInteger(step.exitCode) ? step.exitCode : null,
        outputHash,
        stdoutHash,
        stderrHash,
        typeof step.observation === "string" ? step.observation : null,
        now(),
      );
    }
  }
  return artifactId;
}

function recoverR5Artifacts() {
  let rows: any[] = [];
  try {
    rows = getDb()
      .prepare(
        "SELECT id,target_relpath,artifact_json,expected_file_hash,status FROM r5_artifact_outbox WHERE status='pending' ORDER BY created_at",
      )
      .all() as any[];
  } catch {
    return;
  }
  for (const row of rows) {
    try {
      const target = safePrivateRelative(row.target_relpath);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      if (fs.existsSync(target)) {
        if (sha256(fs.readFileSync(target)) !== row.expected_file_hash)
          throw new Error("pending artifact bytes differ from expected hash");
      } else {
        const temporary = `${target}.recover-${process.pid}-${Date.now()}`;
        fs.writeFileSync(temporary, row.artifact_json, { mode: 0o600, flag: "wx" });
        fs.renameSync(temporary, target);
      }
      transaction((db) =>
        db
          .prepare(
            "UPDATE r5_artifact_outbox SET status='written',written_at=?,attempt_count=attempt_count+1 WHERE id=?",
          )
          .run(now(), row.id),
      );
    } catch (error) {
      transaction((db) =>
        db
          .prepare(
            "UPDATE r5_artifact_outbox SET status='failed',last_error=?,attempt_count=attempt_count+1 WHERE id=?",
          )
          .run(error instanceof Error ? error.message.slice(0, 500) : String(error), row.id),
      );
      throw new AppError("R5_ARTIFACT_RECOVERY_FAILED", "R5 artifact outbox 恢复失败", 409);
    }
  }
}

function writeArtifact(
  session: any,
  kind: "exercise" | "understanding" | "handoff",
  value: unknown,
) {
  ensureRoot();
  const bytes = `${canonicalize(value)}\n`;
  const hash = sha256(bytes);
  const revision = r5ArtifactRevision(session, kind);
  const filename = `${kind}.r${revision}.json`;
  const aliasFilename = `${kind}.json`;
  const directory = path.join(config.privateEvidenceRoot, "gates", "R5", "artifacts", session.role);
  const legacyDirectory = path.join(config.privateEvidenceRoot, "r5", session.role, session.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${session.id}.${filename}`);
  const alias = path.join(legacyDirectory, aliasFilename);
  const column = `${kind}_json`;
  const hashColumn = `${kind}_hash`;
  const pathColumn = artifactPathColumn(kind);
  const previousHash = session[hashColumn] as string | null | undefined;
  if (previousHash) {
    if (previousHash === hash) {
      const previousPath = session[pathColumn] as string | null | undefined;
      const currentTarget = previousPath ? safePrivateRelative(previousPath) : target;
      const currentFilename = path.basename(currentTarget);
      if (!fs.existsSync(currentTarget) || sha256(fs.readFileSync(currentTarget)) !== previousHash)
        throw new AppError(
          "R5_ARTIFACT_TAMPERED",
          `${currentFilename} 文件缺失或 hash 不一致`,
          409,
        );
      if (fs.existsSync(alias) && sha256(fs.readFileSync(alias)) !== previousHash)
        throw new AppError("R5_ARTIFACT_TAMPERED", `${aliasFilename} 文件已被外部修改`, 409);
      return {
        logicalId: path
          .relative(path.join(config.privateEvidenceRoot, "r5"), currentTarget)
          .replaceAll("\\", "/"),
        sha256: hash,
      };
    }
    // A changed artifact is a revision. It invalidates any common bundle and
    // forces both roles to finalize the same bound commit again.
    invalidateBundle(session.bound_commit);
  }
  if (fs.existsSync(target)) {
    const onDiskHash = sha256(fs.readFileSync(target));
    if (onDiskHash !== hash)
      throw new AppError("R5_ARTIFACT_TAMPERED", `${filename} 文件已被外部修改`, 409);
  }
  if (fs.existsSync(alias) && previousHash && sha256(fs.readFileSync(alias)) !== previousHash)
    throw new AppError("R5_ARTIFACT_TAMPERED", `${aliasFilename} 文件已被外部修改`, 409);
  const relativePath = path.relative(config.privateEvidenceRoot, target).replaceAll("\\", "/");
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
  let normalizedArtifactId: string | null = null;
  transaction((db) => {
    db.prepare(
      `UPDATE r5_sessions SET ${column}=?,${hashColumn}=?,${pathColumn}=?,updated_at=? WHERE id=?`,
    ).run(bytes, hash, relativePath, now(), session.id);
    normalizedArtifactId = persistNormalizedOwnerArtifact(
      db,
      session,
      kind,
      value,
      bytes,
      hash,
      revision,
    );
    db.prepare(
      "INSERT INTO r5_artifact_outbox(id,session_id,kind,target_relpath,artifact_json,expected_file_hash,status,created_at,artifact_kind,artifact_id,canonical_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id("r5-outbox"),
      session.id,
      kind,
      relativePath,
      bytes,
      hash,
      "pending",
      now(),
      "owner_artifact",
      normalizedArtifactId ?? session.id,
      bytes,
    );
  });
  try {
    fs.renameSync(temporary, target);
    fs.writeFileSync(alias, bytes, { mode: 0o600 });
    transaction((db) =>
      db
        .prepare(
          "UPDATE r5_artifact_outbox SET status='written',written_at=?,attempt_count=attempt_count+1 WHERE target_relpath=?",
        )
        .run(now(), relativePath),
    );
  } catch (error) {
    throw new AppError(
      "R5_ARTIFACT_WRITE_PENDING",
      `R5 artifact 已进入 outbox，等待恢复: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`,
      503,
    );
  }
  return { logicalId: `${session.role}/${session.id}/${filename}`, sha256: hash };
}

function parseJsonObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("INVALID_INPUT", "R5 body 必须是对象", 422);
  return body as Record<string, unknown>;
}

function markNormalizedArtifactPassed(
  session: any,
  kind: "exercise" | "understanding" | "handoff",
  hash: string,
) {
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_owner_artifacts SET status='passed',finalized_at=? WHERE role=? AND artifact_type=? AND artifact_hash=? AND is_current=1",
      )
      .run(now(), session.role, kind, hash),
  );
}

function r5Session(idValue: unknown, role: Role) {
  if (typeof idValue !== "string" || idValue.length > 128)
    throw new AppError("INVALID_INPUT", "R5 sessionId 无效", 422);
  const session = getDb()
    .prepare("SELECT * FROM r5_sessions WHERE id=? AND role=?")
    .get(idValue, role) as any;
  if (!session) throw new AppError("NOT_FOUND", "R5 session 不存在", 404);
  return session;
}

function expectedRevision(value: unknown, actual: number) {
  if (!Number.isInteger(value) || value !== actual)
    throw new AppError("R5_REVISION_CONFLICT", "R5 草稿 revision 已变化，请刷新后重试", 409);
}

function r5ResponseSteps() {
  return EXERCISE_COMMANDS.map(({ id: stepId, commandId, cwd, required }) => ({
    id: stepId,
    commandId,
    cwd,
    required,
  }));
}

export function createExercise(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, ["rcCommit", "r1R4IndexHash", "exerciseCatalogHash"]);
  const commit = fullCommit(input.rcCommit);
  const indexHash = assertR1R4Index(input.r1R4IndexHash);
  const suppliedCatalogHash = assertHash(input.exerciseCatalogHash, "exerciseCatalogHash");
  const actualCatalogHash = exerciseCatalogHash();
  if (suppliedCatalogHash !== actualCatalogHash)
    throw new AppError("R5_CATALOG_MISMATCH", "R5 exercise catalog hash 不匹配", 409);
  const role = roleFromSession(roleName);
  const session = sessionFor(role, commit);
  if (session.exercise_status && session.exercise_status !== "not_started") {
    if (
      session.exercise_index_hash !== indexHash ||
      session.exercise_catalog_hash !== actualCatalogHash ||
      session.exercise_environment_hash !== ENVIRONMENT_HASH
    )
      throw new AppError("R5_REVISION_CONFLICT", "R5 已存在不同固定输入的 exercise draft", 409);
    workspaceState(session);
    return {
      exerciseId: session.id,
      revision: session.exercise_revision,
      status: session.exercise_status,
      boundCommit: session.bound_commit,
      boundTreeHash: session.exercise_bound_tree_hash,
      environmentHash: session.exercise_environment_hash,
      r1R4IndexHash: session.exercise_index_hash,
      exerciseCatalogHash: session.exercise_catalog_hash,
      steps: r5ResponseSteps(),
      reused: true,
    };
  }
  const workspace = createCleanWorkspace(session);
  const cloneCatalogHash = fixedFileHash(
    path.join(workspace.root, "docs", "owner-handoff", "r5-exercise-catalog.v1.json"),
  );
  const cloneIndexHash = fixedFileHash(
    path.join(workspace.root, "docs", "gate-attestation-index.json"),
  );
  if (cloneCatalogHash !== actualCatalogHash || cloneIndexHash !== indexHash) {
    fs.rmSync(workspace.root, { recursive: true, force: true });
    throw new AppError("R5_INPUT_DRIFT", "clean clone 中的 catalog/index 与绑定 hash 不一致", 409);
  }
  const revision = 1;
  const steps = r5ResponseSteps();
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET exercise_revision=?,exercise_status='draft',exercise_bound_tree_hash=?,exercise_environment_hash=?,exercise_index_hash=?,exercise_catalog_hash=?,exercise_root=?,exercise_steps_json=?,exercise_observations_json='{}',updated_at=? WHERE id=?",
      )
      .run(
        revision,
        workspace.tree,
        ENVIRONMENT_HASH,
        indexHash,
        actualCatalogHash,
        workspace.root,
        JSON.stringify(steps),
        now(),
        session.id,
      ),
  );
  return {
    exerciseId: session.id,
    revision,
    status: "draft",
    boundCommit: commit,
    boundTreeHash: workspace.tree,
    environmentHash: ENVIRONMENT_HASH,
    r1R4IndexHash: indexHash,
    exerciseCatalogHash: actualCatalogHash,
    steps,
    reused: false,
  };
}

function safeOutput(value: unknown): Buffer<ArrayBufferLike> {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value);
  return Buffer.alloc(0);
}

function fixedEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", CI: "1" };
  for (const key of allowed) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function runExerciseStepById(
  roleName: string,
  exerciseId: unknown,
  stepId: unknown,
  body: unknown,
) {
  const input = parseJsonObject(body);
  assertExact(input, ["expectedRevision", "observation"]);
  if (typeof input.observation !== "string" || input.observation.trim().length === 0)
    throw new AppError("INVALID_EXERCISE", "每个 step 都必须填写 observation", 422);
  if (input.observation.length > 1000)
    throw new AppError("INPUT_TOO_LARGE", "R5 observation 最多 1000 字符", 422);
  if (typeof stepId !== "string" || !EXERCISES.includes(stepId as (typeof EXERCISES)[number]))
    throw new AppError("INVALID_EXERCISE", "stepId 必须来自固定 R5 exercise catalog", 422);
  const role = roleFromSession(roleName);
  const session = r5Session(exerciseId, role);
  expectedRevision(input.expectedRevision, session.exercise_revision);
  if (session.exercise_status !== "draft")
    throw new AppError("R5_EXERCISE_STATE", "exercise 不在可执行 draft 状态", 409);
  const { root } = workspaceState(session);
  const command = EXERCISE_COMMANDS.find((item) => item.id === stepId)!;
  const script = path.join(root, ...command.argv);
  if (!path.isAbsolute(script) || !fs.existsSync(script))
    throw new AppError("R5_EXERCISE_VERSION", "绑定 rcCommit 中缺少固定 exercise runner", 409);
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let exitCode = 0;
  try {
    stdout = safeOutput(
      execFileSync(process.execPath, [script, stepId], {
        cwd: root,
        env: fixedEnvironment(),
        encoding: "buffer",
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error: any) {
    exitCode = typeof error?.status === "number" ? error.status : 1;
    stdout = safeOutput(error?.stdout);
    stderr = safeOutput(error?.stderr);
  }
  const observation = input.observation.trim();
  const observations = JSON.parse(session.exercise_observations_json ?? "{}") as Record<
    string,
    unknown
  >;
  const result = {
    id: stepId,
    commandId: command.commandId,
    cwd: command.cwd,
    exitCode,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    observation,
    passed: exitCode === 0,
  };
  observations[stepId] = result;
  const revision = session.exercise_revision + 1;
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET exercise_revision=?,exercise_observations_json=?,updated_at=? WHERE id=?",
      )
      .run(revision, JSON.stringify(observations), now(), session.id),
  );
  return { exerciseId: session.id, stepId, revision, ...result };
}

export function runExerciseStep(
  roleName: string,
  exerciseId: unknown,
  stepId: unknown,
  body: unknown,
) {
  return runExerciseStepById(roleName, exerciseId, stepId, body);
}

export function finalizeExercise(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, ["sessionId", "expectedRevision", "reauthReviewToken"]);
  const role = roleFromSession(roleName);
  if (
    !reviewerReauthMatches(
      roleName as "computer_reviewer" | "math_reviewer",
      input.reauthReviewToken as string,
    )
  )
    throw new AppError("REAUTH_REQUIRED", "R5 finalize 需要本人 reviewer token 二次认证", 403);
  const session = r5Session(input.sessionId, role);
  if (
    session.exercise_status === "passed" &&
    session.exercise_hash &&
    session.exercise_artifact_path
  ) {
    const file = safePrivateRelative(session.exercise_artifact_path);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== session.exercise_hash)
      throw new AppError("R5_ARTIFACT_TAMPERED", "exercise artifact 缺失或 hash 不一致", 409);
    return {
      exerciseId: session.id,
      revision: session.exercise_revision,
      status: "passed",
      artifact: {
        logicalId: path
          .relative(path.join(config.privateEvidenceRoot, "r5"), file)
          .replaceAll("\\", "/"),
        sha256: session.exercise_hash,
      },
      reused: true,
    };
  }
  expectedRevision(input.expectedRevision, session.exercise_revision);
  if (session.exercise_status !== "draft")
    throw new AppError("R5_EXERCISE_STATE", "exercise 不在可 finalize 状态", 409);
  workspaceState(session);
  const observations = JSON.parse(session.exercise_observations_json ?? "{}") as Record<
    string,
    any
  >;
  const steps = EXERCISE_COMMANDS.map((command) => observations[command.id]).filter(Boolean);
  if (
    steps.length !== EXERCISES.length ||
    steps.some(
      (step) => step.passed !== true || typeof step.observation !== "string" || !step.observation,
    )
  )
    throw new AppError(
      "R5_EXERCISE_INCOMPLETE",
      "六个固定 step 必须全部执行成功并填写 observation",
      409,
    );
  const artifact = {
    schemaVersion: "r5-exercise-v2",
    role,
    commit: session.bound_commit,
    boundTreeHash: session.exercise_bound_tree_hash,
    r1R4IndexHash: session.exercise_index_hash,
    exerciseCatalogHash: session.exercise_catalog_hash,
    environmentHash: session.exercise_environment_hash,
    steps,
    allCriticalStepsPassed: true,
  };
  const stored = writeArtifact(session, "exercise", artifact);
  markNormalizedArtifactPassed(session, "exercise", stored.sha256);
  const revision = session.exercise_revision + 1;
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET exercise_status='passed',exercise_revision=?,updated_at=? WHERE id=?",
      )
      .run(revision, now(), session.id),
  );
  return { exerciseId: session.id, revision, status: "passed", artifact: stored };
}

export function submitExercise(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, ["commit", "commands", "result"]);
  const commit = fullCommit(input.commit);
  if (!Array.isArray(input.commands) || input.commands.length !== EXERCISES.length)
    throw new AppError("INVALID_EXERCISE", "必须逐项提交固定六个练习的命令结果", 422);
  const seen = new Set<string>();
  for (const command of input.commands) {
    if (!command || typeof command !== "object" || Array.isArray(command))
      throw new AppError("INVALID_EXERCISE", "命令结果格式错误", 422);
    const item = command as Record<string, unknown>;
    assertExact(item, ["id", "exitCode", "stdoutSha256", "stderrSha256"]);
    if (
      typeof item.id !== "string" ||
      !EXERCISES.includes(item.id as (typeof EXERCISES)[number]) ||
      seen.has(item.id)
    )
      throw new AppError("INVALID_EXERCISE", "练习 ID 必须来自固定目录且不重复", 422);
    if (
      item.exitCode !== 0 ||
      typeof item.stdoutSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.stdoutSha256) ||
      typeof item.stderrSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.stderrSha256)
    )
      throw new AppError("INVALID_EXERCISE", "每个固定练习必须以 exitCode=0 和脱敏 hash 提交", 422);
    seen.add(item.id);
  }
  if (typeof input.result !== "string" || input.result.trim().length < 20)
    throw new AppError("INVALID_EXERCISE", "result 需要说明实际运行结果", 422);
  const role = roleFromSession(roleName);
  const session = sessionFor(role, commit);
  const artifact = {
    schemaVersion: "r5-exercise-v1",
    role,
    commit,
    commands: input.commands,
    result: input.result,
  };
  const stored = writeArtifact(session, "exercise", artifact);
  markNormalizedArtifactPassed(session, "exercise", stored.sha256);
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET exercise_revision=exercise_revision+1,updated_at=? WHERE id=?",
      )
      .run(now(), session.id),
  );
  return { sessionId: session.id, status: "exercise_recorded", artifact: stored };
}

export function createUnderstanding(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, ["rcCommit", "r1R4IndexHash", "questionSetHash", "answers"]);
  const commit = fullCommit(input.rcCommit);
  assertR1R4Index(input.r1R4IndexHash);
  if (input.questionSetHash !== QUESTION_SET_HASH)
    throw new AppError("R5_QUESTION_SET_MISMATCH", "理解检查题集 hash 不匹配", 409);
  if (!Array.isArray(input.answers) || input.answers.length !== TOPICS.length)
    throw new AppError("INVALID_CHECK", "必须恰好回答固定六个主题", 422);
  const byTopic = new Map<string, string>();
  for (const answer of input.answers) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer))
      throw new AppError("INVALID_CHECK", "答案格式错误", 422);
    const item = answer as Record<string, unknown>;
    assertExact(item, ["topic", "answer"]);
    if (
      typeof item.topic !== "string" ||
      !TOPICS.includes(item.topic as (typeof TOPICS)[number]) ||
      typeof item.answer !== "string" ||
      item.answer.trim().length < 20 ||
      item.answer.length > 1000
    )
      throw new AppError("INVALID_CHECK", "每个主题答案必须为 20–1000 字符", 422);
    if (byTopic.has(item.topic)) throw new AppError("INVALID_CHECK", "六个主题不能重复提交", 422);
    byTopic.set(item.topic, item.answer.trim());
  }
  if (!TOPICS.every((topic) => byTopic.has(topic)))
    throw new AppError("UNDERSTANDING_FAILED", "六类关键题必须全部回答", 422);
  const role = roleFromSession(roleName);
  const session = sessionFor(role, commit);
  if (session.exercise_status !== "passed")
    throw new AppError("R5_EXERCISE_REQUIRED", "必须先完成并 finalize 固定 exercise", 409);
  const scores = TOPICS.map((topic) => {
    const scored = scoreTopic(topic, byTopic.get(topic)!);
    return {
      topic,
      score: scored.score,
      points: scored.points.filter(Boolean).length,
      possiblePoints: scored.points.length,
      criticalPassed: scored.criticalPassed,
    };
  });
  const totalScore = Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length);
  const criticalPassed = scores.every((item) => item.criticalPassed);
  const passed = criticalPassed && totalScore >= 80;
  const draft = {
    schemaVersion: "r5-understanding-check-v1",
    role,
    commit,
    rubricVersion: R5_RUBRIC_VERSION,
    questionSetHash: QUESTION_SET_HASH,
    answers: TOPICS.map((topic) => ({ topic, answer: byTopic.get(topic)! })),
    scores,
    totalScore,
    criticalPassed,
    passed,
  };
  const revision = session.understanding_revision + 1;
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET understanding_revision=?,understanding_status=?,understanding_json=?,updated_at=? WHERE id=?",
      )
      .run(revision, passed ? "ready" : "failed", JSON.stringify(draft), now(), session.id),
  );
  return {
    sessionId: session.id,
    revision,
    status: passed ? "ready_to_finalize" : "failed",
    passed,
    rubricVersion: R5_RUBRIC_VERSION,
    questionSetHash: QUESTION_SET_HASH,
    scores,
    totalScore,
    criticalPassed,
  };
}

export function finalizeUnderstanding(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, ["sessionId", "expectedRevision", "reauthReviewToken"]);
  if (
    !reviewerReauthMatches(
      roleName as "computer_reviewer" | "math_reviewer",
      input.reauthReviewToken as string,
    )
  )
    throw new AppError(
      "REAUTH_REQUIRED",
      "理解检查 finalize 需要本人 reviewer token 二次认证",
      403,
    );
  const role = roleFromSession(roleName);
  const session = r5Session(input.sessionId, role);
  if (
    session.understanding_status === "passed" &&
    session.understanding_hash &&
    session.understanding_artifact_path
  ) {
    const file = safePrivateRelative(session.understanding_artifact_path);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== session.understanding_hash)
      throw new AppError("R5_ARTIFACT_TAMPERED", "understanding artifact 缺失或 hash 不一致", 409);
    return {
      sessionId: session.id,
      revision: session.understanding_revision,
      status: "passed",
      artifact: {
        logicalId: path
          .relative(path.join(config.privateEvidenceRoot, "r5"), file)
          .replaceAll("\\", "/"),
        sha256: session.understanding_hash,
      },
      reused: true,
    };
  }
  expectedRevision(input.expectedRevision, session.understanding_revision);
  const draft = JSON.parse(session.understanding_json ?? "null") as any;
  if (session.understanding_status !== "ready" || !draft?.passed)
    throw new AppError("R5_UNDERSTANDING_FAILED", "理解检查未达到服务端固定评分门槛", 409);
  const stored = writeArtifact(session, "understanding", draft);
  markNormalizedArtifactPassed(session, "understanding", stored.sha256);
  const revision = session.understanding_revision + 1;
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET understanding_status='passed',understanding_revision=?,updated_at=? WHERE id=?",
      )
      .run(revision, now(), session.id),
  );
  return { sessionId: session.id, revision, status: "passed", artifact: stored };
}

function handoffEvidence() {
  const paths = [
    "docs/gate-attestation-index.json",
    "docs/validation-log.md",
    "docs/release-validation-log.md",
    "deliverables/research-report/AccessCheck_Lishui_研究报告.md",
    "deliverables/federation-report/丽水市公共数字服务信息无障碍自动评估报告.md",
  ];
  const files = paths.map((relativePath) => {
    const absolute = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(absolute))
      throw new AppError("R5_HANDOFF_EVIDENCE_MISSING", `缺少正式交接证据: ${relativePath}`, 409);
    return { path: relativePath.replaceAll("\\", "/"), sha256: sha256(fs.readFileSync(absolute)) };
  });
  return { files, evidenceHash: sha256(canonicalize(files)) };
}

export function createHandoff(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, [
    "rcCommit",
    "r1R4IndexHash",
    "handoffCatalogHash",
    "confirmGateIds",
    "reauthReviewToken",
  ]);
  if (
    !reviewerReauthMatches(
      roleName as "computer_reviewer" | "math_reviewer",
      input.reauthReviewToken as string,
    )
  )
    throw new AppError("REAUTH_REQUIRED", "handoff 需要本人 reviewer token 二次认证", 403);
  const commit = fullCommit(input.rcCommit);
  assertR1R4Index(input.r1R4IndexHash);
  const catalogPath = path.join(
    process.cwd(),
    "docs",
    "owner-handoff",
    "r5-handoff-catalog.v1.json",
  );
  const catalogHash = fixedFileHash(catalogPath);
  if (input.handoffCatalogHash !== catalogHash)
    throw new AppError("R5_CATALOG_MISMATCH", "R5 handoff catalog hash 不匹配", 409);
  if (
    !Array.isArray(input.confirmGateIds) ||
    input.confirmGateIds.length !== HANDOFF_ITEMS.length ||
    [...input.confirmGateIds].sort().join(",") !== "A,B,C,D,E"
  )
    throw new AppError("INVALID_HANDOFF", "必须逐项确认 A–E 五个交接门", 422);
  const evidence = handoffEvidence();
  const role = roleFromSession(roleName);
  const session = sessionFor(role, commit);
  if (session.exercise_status !== "passed" || session.understanding_status !== "passed")
    throw new AppError(
      "R5_PREREQUISITES_REQUIRED",
      "handoff 前必须完成 exercise 和 understanding",
      409,
    );
  const artifact = {
    schemaVersion: "r5-handoff-v1",
    role,
    commit,
    r1R4IndexHash: input.r1R4IndexHash,
    handoffCatalogHash: catalogHash,
    confirmGateIds: ["A", "B", "C", "D", "E"],
    evidence,
    confirmed: true,
  };
  const stored = writeArtifact(session, "handoff", artifact);
  markNormalizedArtifactPassed(session, "handoff", stored.sha256);
  transaction((db) =>
    db
      .prepare("UPDATE r5_sessions SET handoff_revision=handoff_revision+1,updated_at=? WHERE id=?")
      .run(now(), session.id),
  );
  return {
    sessionId: session.id,
    status: "passed",
    evidenceHash: evidence.evidenceHash,
    artifact: stored,
  };
}

export function submitUnderstanding(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, ["sessionId", "answers"]);
  if (typeof input.sessionId !== "string" || !Array.isArray(input.answers))
    throw new AppError("INVALID_CHECK", "sessionId 和 answers 必填", 422);
  const role = roleFromSession(roleName);
  const session = getDb()
    .prepare("SELECT * FROM r5_sessions WHERE id=? AND role=?")
    .get(input.sessionId, role) as any;
  if (!session) throw new AppError("NOT_FOUND", "R5 session 不存在", 404);
  const answers = input.answers as unknown[];
  const byTopic = new Map<string, string>();
  if (answers.length !== TOPICS.length)
    throw new AppError("INVALID_CHECK", "必须恰好回答固定六个主题", 422);
  for (const answer of answers) {
    if (!answer || typeof answer !== "object" || Array.isArray(answer))
      throw new AppError("INVALID_CHECK", "答案格式错误", 422);
    const item = answer as Record<string, unknown>;
    assertExact(item, ["topic", "answer"]);
    if (
      typeof item.topic !== "string" ||
      !TOPICS.includes(item.topic as (typeof TOPICS)[number]) ||
      typeof item.answer !== "string" ||
      item.answer.trim().length < 20
    )
      throw new AppError("INVALID_CHECK", "六个固定主题均需填写不少于 20 字的本人解释", 422);
    if (byTopic.has(item.topic)) throw new AppError("INVALID_CHECK", "六个主题不能重复提交", 422);
    byTopic.set(item.topic, item.answer.trim());
  }
  if (!TOPICS.every((topic) => byTopic.has(topic)))
    throw new AppError("UNDERSTANDING_FAILED", "六类关键题必须全部回答，服务端未通过门槛", 422);
  const scores = TOPICS.map((topic) => {
    const scored = scoreTopic(topic, byTopic.get(topic)!);
    return {
      topic,
      score: scored.score,
      points: scored.points.filter(Boolean).length,
      possiblePoints: scored.points.length,
      criticalPassed: scored.criticalPassed,
    };
  });
  const totalScore = Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length);
  const criticalPassed = scores.every((item) => item.criticalPassed);
  const passed = criticalPassed && totalScore >= 80;
  const normalizedAnswers = TOPICS.map((topic) => ({ topic, answer: byTopic.get(topic)! }));
  const artifact = {
    schemaVersion: "r5-understanding-check-v1",
    role,
    rubricVersion: R5_RUBRIC_VERSION,
    questionSetHash: QUESTION_SET_HASH,
    answers: normalizedAnswers,
    scores,
    totalScore,
    criticalPassed,
    passed,
  };
  const stored = writeArtifact(session, "understanding", artifact);
  markNormalizedArtifactPassed(session, "understanding", stored.sha256);
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET understanding_revision=understanding_revision+1,understanding_status=?,updated_at=? WHERE id=?",
      )
      .run(artifact.passed ? "passed" : "failed", now(), session.id),
  );
  return {
    sessionId: session.id,
    status: passed ? "understanding_recorded" : "understanding_failed",
    passed,
    rubricVersion: R5_RUBRIC_VERSION,
    questionSetHash: QUESTION_SET_HASH,
    scores,
    totalScore,
    criticalPassed,
    artifact: stored,
  };
}

export function submitHandoff(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, ["sessionId", "items"]);
  if (typeof input.sessionId !== "string" || !Array.isArray(input.items))
    throw new AppError("INVALID_HANDOFF", "sessionId 和 items 必填", 422);
  const role = roleFromSession(roleName);
  const session = getDb()
    .prepare("SELECT * FROM r5_sessions WHERE id=? AND role=?")
    .get(input.sessionId, role) as any;
  if (!session) throw new AppError("NOT_FOUND", "R5 session 不存在", 404);
  const byId = new Map<string, string>();
  for (const item of input.items) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new AppError("INVALID_HANDOFF", "交接项格式错误", 422);
    const record = item as Record<string, unknown>;
    assertExact(record, ["id", "note"]);
    if (
      typeof record.id !== "string" ||
      !HANDOFF_ITEMS.includes(record.id as (typeof HANDOFF_ITEMS)[number]) ||
      typeof record.note !== "string" ||
      record.note.trim().length < 20
    )
      throw new AppError("INVALID_HANDOFF", "A–E 五项交接确认必须逐项填写本人说明", 422);
    byId.set(record.id, record.note.trim());
  }
  if (!HANDOFF_ITEMS.every((item) => byId.has(item)))
    throw new AppError("HANDOFF_FAILED", "五项交接确认必须全部完成", 422);
  const normalizedItems = HANDOFF_ITEMS.map((id) => ({ id, note: byId.get(id) }));
  const artifact = {
    schemaVersion: "r5-handoff-v1",
    role,
    items: normalizedItems,
    confirmed: true,
  };
  const stored = writeArtifact(session, "handoff", artifact);
  markNormalizedArtifactPassed(session, "handoff", stored.sha256);
  transaction((db) =>
    db
      .prepare("UPDATE r5_sessions SET handoff_revision=handoff_revision+1,updated_at=? WHERE id=?")
      .run(now(), session.id),
  );
  return { sessionId: session.id, status: "handoff_recorded", confirmed: true, artifact: stored };
}

function buildBundle(boundCommit: string) {
  const sessions = getDb()
    .prepare("SELECT * FROM r5_sessions WHERE bound_commit=? AND status='finalized' ORDER BY role")
    .all(boundCommit) as any[];
  if (sessions.length !== 2 || new Set(sessions.map((session) => session.role)).size !== 2)
    return null;
  const artifactHashes: string[] = [];
  for (const session of sessions) {
    for (const [kind, hash] of [
      ["exercise", session.exercise_hash],
      ["understanding", session.understanding_hash],
      ["handoff", session.handoff_hash],
    ] as Array<[string, unknown]>) {
      if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) return null;
      const artifactPath = session[`${kind}_artifact_path`] as string | null | undefined;
      if (!artifactPath)
        throw new AppError("R5_ARTIFACT_MISSING", `${kind} artifact path 缺失`, 409);
      const file = safePrivateRelative(artifactPath);
      if (!fs.existsSync(file))
        throw new AppError("R5_ARTIFACT_MISSING", `${kind}.json 文件缺失`, 409);
      if (sha256(fs.readFileSync(file)) !== hash)
        throw new AppError("R5_ARTIFACT_TAMPERED", `${kind}.json hash 不一致`, 409);
      const logicalId = path
        .relative(path.join(config.privateEvidenceRoot, "r5"), file)
        .replaceAll("\\", "/");
      artifactHashes.push(`${logicalId}:${hash}`);
    }
  }
  artifactHashes.sort();
  const bundle = {
    schemaVersion: "r5-artifact-bundle-v1",
    artifactHashes,
    status: "verified" as const,
    bundleHash: sha256(
      canonicalize({ schemaVersion: "r5-artifact-bundle-v1", artifactHashes, status: "verified" }),
    ),
  };
  ensureRoot();
  const directory = path.join(config.privateEvidenceRoot, "gates", "R5");
  const bundlesDirectory = path.join(directory, "bundles");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(bundlesDirectory, { recursive: true, mode: 0o700 });
  const target = canonicalBundlePath(bundle.bundleHash);
  const alias = bundlePath();
  const bytes = `${canonicalize(bundle)}\n`;
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") !== bytes)
    throw new AppError("R5_BUNDLE_CONFLICT", "R5 common bundle 已存在且内容不同", 409);
  if (fs.existsSync(alias) && fs.readFileSync(alias, "utf8") !== bytes)
    throw new AppError("R5_BUNDLE_CONFLICT", "R5 common bundle alias 已存在且内容不同", 409);
  const metadata = sessions.every(
    (session) =>
      typeof session.exercise_index_hash === "string" &&
      /^[a-f0-9]{64}$/.test(session.exercise_index_hash),
  )
    ? sessions.map((session) => ({
        role: session.role as Role,
        exercise: session.exercise_hash as string,
        understanding: session.understanding_hash as string,
        handoff: session.handoff_hash as string,
        indexHash: session.exercise_index_hash as string,
      }))
    : [];
  let bundleOutboxId: string | null = null;
  if (metadata.length === 2 && metadata.every((item) => Object.values(item).every(Boolean))) {
    const computer = metadata.find((item) => item.role === "computer_lead")!;
    const math = metadata.find((item) => item.role === "math_lead")!;
    const bundleId = id("r5-bundle");
    const rel = path.relative(config.privateEvidenceRoot, target).replaceAll("\\", "/");
    transaction((db) => {
      const existing = db
        .prepare("SELECT id FROM r5_artifact_bundles WHERE bundle_hash=?")
        .get(bundle.bundleHash) as { id: string } | undefined;
      if (!existing) {
        db.prepare(
          "INSERT INTO r5_artifact_bundles(id,rc_commit,r1_r4_index_hash,computer_exercise_hash,computer_understanding_hash,computer_handoff_hash,math_exercise_hash,math_understanding_hash,math_handoff_hash,status,bundle_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          bundleId,
          boundCommit,
          computer.indexHash,
          computer.exercise,
          computer.understanding,
          computer.handoff,
          math.exercise,
          math.understanding,
          math.handoff,
          "ready",
          bundle.bundleHash,
          now(),
        );
        bundleOutboxId = id("r5-outbox");
        // The legacy `kind` column has a restrictive check; artifact_kind is
        // the authoritative normalized discriminator and remains `bundle`.
        db.prepare(
          "INSERT INTO r5_artifact_outbox(id,session_id,kind,target_relpath,artifact_json,expected_file_hash,status,created_at,artifact_kind,artifact_id,canonical_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          bundleOutboxId,
          sessions[0].id,
          "handoff",
          rel,
          bytes,
          sha256(bytes),
          "pending",
          now(),
          "bundle",
          bundleId,
          bytes,
        );
      }
    });
  }
  if (!fs.existsSync(target)) {
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  }
  if (!fs.existsSync(alias)) fs.writeFileSync(alias, bytes, { mode: 0o600 });
  if (bundleOutboxId)
    transaction((db) =>
      db
        .prepare(
          "UPDATE r5_artifact_outbox SET status='written',written_at=?,attempt_count=attempt_count+1 WHERE id=?",
        )
        .run(now(), bundleOutboxId),
    );
  return bundle;
}

export function finalizeR5(roleName: string, body: unknown) {
  const input = parseJsonObject(body);
  assertExact(input, ["sessionId"]);
  const role = roleFromSession(roleName);
  if (typeof input.sessionId !== "string")
    throw new AppError("INVALID_INPUT", "sessionId 必填", 422);
  const session = getDb()
    .prepare("SELECT * FROM r5_sessions WHERE id=? AND role=?")
    .get(input.sessionId, role) as any;
  if (!session) throw new AppError("NOT_FOUND", "R5 session 不存在", 404);
  if (
    !session.exercise_json ||
    !session.exercise_hash ||
    !session.understanding_json ||
    !session.understanding_hash ||
    !session.handoff_json ||
    !session.handoff_hash
  )
    throw new AppError("R5_INCOMPLETE", "exercise、理解检查和交接三类 artifact 必须先完成", 409);
  const understanding = JSON.parse(session.understanding_json) as {
    questionSetHash?: string;
    passed?: boolean;
    criticalPassed?: boolean;
    totalScore?: number;
  };
  if (
    understanding.questionSetHash !== QUESTION_SET_HASH ||
    understanding.passed !== true ||
    understanding.criticalPassed !== true ||
    typeof understanding.totalScore !== "number" ||
    understanding.totalScore < 80
  )
    throw new AppError("R5_UNDERSTANDING_FAILED", "理解检查未达到服务端固定评分门槛", 409);
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET status='finalized',finalized_at=COALESCE(finalized_at,?),updated_at=? WHERE id=?",
      )
      .run(now(), now(), session.id),
  );
  const bundle = buildBundle(session.bound_commit);
  return {
    sessionId: session.id,
    status: "finalized",
    boundCommit: session.bound_commit,
    artifactBundle: bundle,
  };
}

export function r5Status(roleName: string) {
  const role = roleFromSession(roleName);
  const rows = getDb()
    .prepare(
      "SELECT id,bound_commit,status,exercise_status,exercise_revision,understanding_status,understanding_revision,handoff_revision,exercise_hash,understanding_hash,handoff_hash,created_at,updated_at,finalized_at FROM r5_sessions WHERE role=? ORDER BY updated_at DESC",
    )
    .all(role) as any[];
  const peers = getDb()
    .prepare(
      "SELECT role,bound_commit,status,exercise_status,understanding_status,handoff_revision FROM r5_sessions WHERE role<>? ORDER BY updated_at DESC",
    )
    .all(role) as any[];
  const bundle = getDb()
    .prepare(
      "SELECT rc_commit,bundle_hash,status,created_at FROM r5_artifact_bundles WHERE status='ready' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as
    | { rc_commit: string; bundle_hash: string; status: string; created_at: string }
    | undefined;
  return {
    role,
    sessions: rows.map((row) => ({
      ...row,
      hasExercise: Boolean(row.exercise_hash),
      hasUnderstanding: Boolean(row.understanding_hash),
      hasHandoff: Boolean(row.handoff_hash),
    })),
    otherRoleSessions: peers.map((row) => ({
      role: row.role,
      boundCommit: row.bound_commit,
      status: row.status,
      exerciseStatus: row.exercise_status,
      understandingStatus: row.understanding_status,
      handoffRevision: row.handoff_revision,
    })),
    artifactBundle: bundle
      ? {
          boundCommit: bundle.rc_commit,
          bundleHash: bundle.bundle_hash,
          status: bundle.status,
          createdAt: bundle.created_at,
        }
      : null,
  };
}

/**
 * R5 gate evidence is derived from the one server-created ready bundle.  The
 * caller supplies only the rcCommit; it cannot choose artifact paths or hashes.
 */
export function r5GateArtifacts(boundCommit: string) {
  const commit = fullCommit(boundCommit);
  const bundle = getDb()
    .prepare(
      "SELECT * FROM r5_artifact_bundles WHERE rc_commit=? AND status='ready' ORDER BY created_at DESC LIMIT 1",
    )
    .get(commit) as any;
  if (!bundle)
    throw new AppError("R5_BUNDLE_REQUIRED", "没有绑定该 rcCommit 的 ready R5 bundle", 409);
  const expected = [
    ["computer_lead", "exercise", bundle.computer_exercise_hash],
    ["computer_lead", "understanding", bundle.computer_understanding_hash],
    ["computer_lead", "handoff", bundle.computer_handoff_hash],
    ["math_lead", "exercise", bundle.math_exercise_hash],
    ["math_lead", "understanding", bundle.math_understanding_hash],
    ["math_lead", "handoff", bundle.math_handoff_hash],
  ] as const;
  for (const [role, kind, hash] of expected) {
    const artifact = getDb()
      .prepare(
        "SELECT artifact_hash,status,is_current FROM r5_owner_artifacts WHERE role=? AND artifact_type=? AND artifact_hash=? AND status='passed' AND is_current=1",
      )
      .get(role, kind, hash) as { artifact_hash: string } | undefined;
    if (!artifact)
      throw new AppError("R5_ARTIFACT_INVALID", `${role}/${kind} R5 artifact 不再有效`, 409);
    const session = getDb()
      .prepare("SELECT * FROM r5_sessions WHERE role=? AND bound_commit=? AND status='finalized'")
      .get(role, commit) as any;
    const artifactPath = session?.[`${kind}_artifact_path`] as string | null | undefined;
    if (!artifactPath)
      throw new AppError("R5_ARTIFACT_INVALID", `${role}/${kind} artifact path 缺失`, 409);
    const file = safePrivateRelative(artifactPath);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== hash)
      throw new AppError("R5_ARTIFACT_TAMPERED", `${role}/${kind} artifact 文件 hash 不匹配`, 409);
  }
  const bundleFile = canonicalBundlePath(bundle.bundle_hash);
  let parsedBundle: any;
  try {
    parsedBundle = JSON.parse(fs.readFileSync(bundleFile, "utf8"));
  } catch {
    parsedBundle = null;
  }
  if (
    !parsedBundle ||
    parsedBundle.bundleHash !== bundle.bundle_hash ||
    sha256(
      canonicalize({
        schemaVersion: parsedBundle.schemaVersion,
        artifactHashes: parsedBundle.artifactHashes,
        status: parsedBundle.status,
      }),
    ) !== bundle.bundle_hash
  )
    throw new AppError("R5_BUNDLE_INVALID", "R5 bundle 文件缺失或 hash 不匹配", 409);
  return expected.map(([role, kind, hash]) => ({
    logicalId: `R5/${role}/${kind}`,
    sha256: hash,
  }));
}
