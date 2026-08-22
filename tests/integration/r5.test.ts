import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { canonicalize, sha256 } from "@/lib/canonical";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-r5-"));
process.env.DATABASE_URL = path.join(root, "r5.db");
process.env.PRIVATE_EVIDENCE_ROOT = path.join(root, "private");
const db = await import("@/lib/db");
const r5 = await import("@/lib/r5");

const commands = [
  "dependency-preflight",
  "fixture-scan",
  "worker-recovery",
  "export-manifest",
  "backup-restore",
  "publication-fail-closed",
].map((id) => ({ id, exitCode: 0, stdoutSha256: "a".repeat(64), stderrSha256: "b".repeat(64) }));
const answers = [
  {
    topic: "ssrf",
    answer:
      "URL 和 DNS 解析经过同一策略，重定向和子资源也检查；拒绝私网 localhost metadata、凭据和危险协议；测试白名单只给 fixture。",
  },
  {
    topic: "axe-severity",
    answer:
      "passes、violations、incomplete、inapplicable 四类结果都保存；incomplete 是不确定失败，violation 才是失败，inapplicable 表示不适用。",
  },
  {
    topic: "wcag-mapping",
    answer:
      "axe tags 解析到冻结成功标准，原则和等级都从目录读取；未知编号不猜，4.1.1 已移除并不评分。",
  },
  {
    topic: "scoring",
    answer:
      "评分使用整数分子和分母，先取 node impact 再取 rule impact，最后固定回退；多原则总分只计一次，最后 half-up 保留一位小数。",
  },
  {
    topic: "worker-lease",
    answer:
      "任务从 queued 到 leased、running、terminal；heartbeat 和 lease 过期可恢复，唯一键保证不重复；取消和部分失败保留事实，崩溃后重启继续。",
  },
  {
    topic: "manifest-traceability",
    answer:
      "用 export-id 和 manifest hash 追踪 run、page、rule、node，报告也有 hash；source 原始证据不会被 final 回写覆盖。",
  },
];
const items = ["handoff-a", "handoff-b", "handoff-c", "handoff-d", "handoff-e"].map((id) => ({
  id,
  note: `本人已完成 ${id} 的练习并能按文件和命令复核结果。`,
}));

describe("R5 server-scored handoff chain", () => {
  beforeAll(() => db.migrate());
  afterAll(() => db.closeDb());

  it("records two role-bound sessions and creates a common bundle only after both finalize", () => {
    const commit = "a".repeat(40);
    const computer = r5.submitExercise("computer_reviewer", {
      commit,
      commands,
      result: "已在准确候选提交上完成六项固定练习并保存脱敏命令摘要。",
    });
    const math = r5.submitExercise("math_reviewer", {
      commit,
      commands,
      result: "已在准确候选提交上完成六项固定练习并保存脱敏命令摘要。",
    });
    r5.submitUnderstanding("computer_reviewer", { sessionId: computer.sessionId, answers });
    r5.submitUnderstanding("math_reviewer", { sessionId: math.sessionId, answers });
    const computerHandoff = r5.submitHandoff("computer_reviewer", {
      sessionId: computer.sessionId,
      items,
    });
    r5.submitHandoff("math_reviewer", { sessionId: math.sessionId, items });
    const first = r5.finalizeR5("computer_reviewer", { sessionId: computer.sessionId });
    expect(first.artifactBundle).toBeNull();
    const second = r5.finalizeR5("math_reviewer", { sessionId: math.sessionId });
    expect(second.artifactBundle?.status).toBe("verified");
    expect(
      fs.existsSync(path.join(root, "private", "gates", "R5", "r5-artifact-bundle.json")),
    ).toBe(true);
    const bundle = JSON.parse(
      fs.readFileSync(path.join(root, "private", "gates", "R5", "r5-artifact-bundle.json"), "utf8"),
    ) as { artifactHashes: string[] };
    expect(bundle.artifactHashes).toHaveLength(6);
    expect(
      bundle.artifactHashes.every((item) =>
        /^artifacts\/(computer_lead|math_lead)\/(exercise|understanding|handoff)\.r1\.json:[a-f0-9]{64}$/.test(
          item,
        ),
      ),
    ).toBe(true);
    const exerciseFile = path.join(
      root,
      "private",
      "gates",
      "R5",
      "artifacts",
      "computer_lead",
      "exercise.r1.json",
    );
    const exerciseBytes = fs.readFileSync(exerciseFile, "utf8");
    const exercise = JSON.parse(exerciseBytes) as Record<string, unknown>;
    expect(exercise.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    const { artifactHash, ...withoutHash } = exercise;
    expect(artifactHash).toBe(`${sha256(`${canonicalize(withoutHash)}\n`)}`);
    expect(sha256(exerciseBytes)).not.toBe(artifactHash);
    const readModel = db
      .getDb()
      .prepare(
        "SELECT exercise_hash,exercise_json FROM r5_sessions WHERE role='computer_lead' AND bound_commit=?",
      )
      .get("a".repeat(40)) as { exercise_hash: string; exercise_json: string };
    expect(readModel.exercise_hash).toBe(artifactHash);
    const outbox = db
      .getDb()
      .prepare(
        "SELECT expected_file_hash FROM r5_artifact_outbox WHERE target_relpath LIKE '%gates/R5/artifacts/computer_lead/exercise.r1.json'",
      )
      .get() as { expected_file_hash: string };
    expect(outbox.expected_file_hash).toBe(sha256(readModel.exercise_json));
    expect(outbox.expected_file_hash).not.toBe(readModel.exercise_hash);
    const revisedItems = items.map((item) => ({ ...item, note: `${item.note} 修订说明` }));
    const revised = r5.submitHandoff("computer_reviewer", {
      sessionId: computer.sessionId,
      items: revisedItems,
    });
    expect(revised.artifact.sha256).not.toBe(computerHandoff.artifact.sha256);
    expect(
      fs.existsSync(path.join(root, "private", "gates", "R5", "r5-artifact-bundle.json")),
    ).toBe(false);
    const handoffPath = path.join(
      root,
      "private",
      "r5",
      "computer_lead",
      computer.sessionId,
      "handoff.json",
    );
    fs.writeFileSync(handoffPath, "tampered\n");
    expect(() =>
      r5.submitHandoff("computer_reviewer", {
        sessionId: computer.sessionId,
        items: revisedItems,
      }),
    ).toThrowError(expect.objectContaining({ code: "R5_ARTIFACT_TAMPERED" }));
  });

  it("rejects a client-supplied pass flag and incomplete topic set", () => {
    expect(() =>
      r5.submitUnderstanding("computer_reviewer", { sessionId: "missing", answers, passed: true }),
    ).toThrow("未定义字段");
    expect(() =>
      r5.submitExercise("computer_reviewer", {
        commit: "c".repeat(40),
        commands: commands.slice(0, 1),
        result: "short",
      }),
    ).toThrow("固定六个");
  });

  it("scores the fixed rubric on the server and records a failed attempt", () => {
    const session = r5.submitExercise("computer_reviewer", {
      commit: "d".repeat(40),
      commands,
      result: "已完成固定六项练习并保存脱敏命令摘要，等待理解检查。",
    });
    const weakAnswers = answers.map(({ topic }) => ({
      topic,
      answer: "这是本人提交的解释，但没有覆盖固定评分要点和实现证据。",
    }));
    const result = r5.submitUnderstanding("computer_reviewer", {
      sessionId: session.sessionId,
      answers: weakAnswers,
    });
    expect(result.passed).toBe(false);
    expect(result.criticalPassed).toBe(false);
    expect(result.totalScore).toBeLessThan(80);
    expect(result.questionSetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the plan's normalized outbox schema and archives reused canonical paths", () => {
    const columns = (
      db.getDb().prepare("PRAGMA table_info(r5_artifact_outbox)").all() as any[]
    ).map((row) => row.name);
    expect(columns).toEqual([
      "id",
      "artifact_kind",
      "artifact_id",
      "target_relpath",
      "canonical_json",
      "expected_file_hash",
      "status",
      "attempt_count",
      "last_error",
      "created_at",
      "written_at",
    ]);
    expect(columns).not.toContain("session_id");
    expect(columns).not.toContain("artifact_json");
    const rows = db
      .getDb()
      .prepare("SELECT artifact_kind,target_relpath,canonical_json,status FROM r5_artifact_outbox")
      .all() as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => ["owner_artifact", "bundle"].includes(row.artifact_kind))).toBe(
      true,
    );
    expect(rows.every((row) => typeof row.canonical_json === "string")).toBe(true);
    expect(
      rows.every((row) => /^gates\/R5\/(artifacts|bundles)\/.+\.json$/.test(row.target_relpath)),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, "private", "gates", "R5", "archive"))).toBe(true);
  });
});
