import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "./canonical";
import { config } from "./config";
import { getDb, migrate, transaction } from "./db";
import { AppError } from "./errors";
import { id } from "./ids";

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
}

function bundlePath() {
  return path.join(config.privateEvidenceRoot, "gates", "R5", "r5-artifact-bundle.json");
}

function invalidateBundle(boundCommit: string) {
  const target = bundlePath();
  if (fs.existsSync(target)) fs.unlinkSync(target);
  transaction((db) =>
    db
      .prepare(
        "UPDATE r5_sessions SET status='started',finalized_at=NULL,updated_at=? WHERE bound_commit=?",
      )
      .run(now(), boundCommit),
  );
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

function writeArtifact(
  session: any,
  kind: "exercise" | "understanding" | "handoff",
  value: unknown,
) {
  ensureRoot();
  const bytes = `${canonicalize(value)}\n`;
  const hash = sha256(bytes);
  const filename = `${kind}.json`;
  const directory = path.join(config.privateEvidenceRoot, "r5", session.role, session.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, filename);
  const column = `${kind}_json`;
  const hashColumn = `${kind}_hash`;
  const previousHash = session[hashColumn] as string | null | undefined;
  if (previousHash) {
    if (previousHash === hash) {
      if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== previousHash)
        throw new AppError("R5_ARTIFACT_TAMPERED", `${filename} 文件缺失或 hash 不一致`, 409);
      return { logicalId: `${session.role}/${session.id}/${filename}`, sha256: hash };
    }
    // A changed artifact is a revision. It invalidates any common bundle and
    // forces both roles to finalize the same bound commit again.
    invalidateBundle(session.bound_commit);
  }
  if (fs.existsSync(target)) {
    const onDiskHash = sha256(fs.readFileSync(target));
    if (onDiskHash !== previousHash)
      throw new AppError("R5_ARTIFACT_TAMPERED", `${filename} 文件已被外部修改`, 409);
  }
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, target);
  transaction((db) => {
    db.prepare(`UPDATE r5_sessions SET ${column}=?,${hashColumn}=?,updated_at=? WHERE id=?`).run(
      bytes,
      hash,
      now(),
      session.id,
    );
  });
  return { logicalId: `${session.role}/${session.id}/${filename}`, sha256: hash };
}

function parseJsonObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AppError("INVALID_INPUT", "R5 body 必须是对象", 422);
  return body as Record<string, unknown>;
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
  return { sessionId: session.id, status: "exercise_recorded", artifact: stored };
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
      const file = path.join(
        config.privateEvidenceRoot,
        "r5",
        session.role,
        session.id,
        `${kind}.json`,
      );
      if (!fs.existsSync(file))
        throw new AppError("R5_ARTIFACT_MISSING", `${kind}.json 文件缺失`, 409);
      if (sha256(fs.readFileSync(file)) !== hash)
        throw new AppError("R5_ARTIFACT_TAMPERED", `${kind}.json hash 不一致`, 409);
      artifactHashes.push(`${session.role}/${session.id}/${kind}.json:${hash}`);
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
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = bundlePath();
  const bytes = `${canonicalize(bundle)}\n`;
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") !== bytes)
    throw new AppError("R5_BUNDLE_CONFLICT", "R5 common bundle 已存在且内容不同", 409);
  if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { mode: 0o600 });
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
  if (!session.exercise_json || !session.understanding_json || !session.handoff_json)
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
      "SELECT id,bound_commit,status,exercise_hash,understanding_hash,handoff_hash,created_at,updated_at,finalized_at FROM r5_sessions WHERE role=? ORDER BY updated_at DESC",
    )
    .all(role) as any[];
  return {
    role,
    sessions: rows.map((row) => ({
      ...row,
      hasExercise: Boolean(row.exercise_hash),
      hasUnderstanding: Boolean(row.understanding_hash),
      hasHandoff: Boolean(row.handoff_hash),
    })),
  };
}
