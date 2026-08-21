import { NextResponse } from "next/server";
import { csrfMatches, requireRole } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { id } from "@/lib/ids";
import { AppError, errorEnvelope } from "@/lib/errors";
export async function POST(request: Request) {
  try {
    migrate();
    const session = await requireRole("computer_reviewer", "math_reviewer");
    if (!csrfMatches(session, request.headers.get("x-csrf-token")))
      throw new AppError("CSRF_INVALID", "CSRF token 无效", 403);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AppError("INVALID_INPUT", "审核请求必须是对象", 422);
    const allowed = new Set(["resultNodeId", "verdict", "note"]);
    if (Object.keys(body).some((key) => !allowed.has(key)))
      throw new AppError("UNKNOWN_FIELD", "ad-hoc 审核只能提交节点、verdict 和 note", 400);
    const resultNodeId = String(body.resultNodeId ?? "");
    const verdict = String(body.verdict ?? "");
    const note = String(body.note ?? "");
    if (note.length > 2000) throw new AppError("INVALID_NOTE", "note 最多 2000 个字符", 422);
    if (!resultNodeId || !["confirmed", "not_an_issue", "uncertain"].includes(verdict))
      throw new AppError("INVALID_REVIEW", "审核对象或 verdict 无效", 422);
    const node = getDb()
      .prepare(
        "SELECT n.id,rr.result_type FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id WHERE n.id=?",
      )
      .get(resultNodeId) as any;
    if (!node) throw new AppError("NOT_FOUND", "节点不存在", 404);
    if (!["violation", "incomplete"].includes(node.result_type))
      throw new AppError("REVIEW_NOT_ALLOWED", "只有 violation/incomplete 节点可以人工审核", 422);
    const reviewer = session.user.role === "computer_reviewer" ? "computer_lead" : "math_lead";
    const context = "ad_hoc";
    const previous = getDb()
      .prepare(
        "SELECT id,revision FROM manual_reviews WHERE result_node_id=? AND reviewer=? AND review_context=? AND is_current=1",
      )
      .get(resultNodeId, reviewer, context) as any;
    const revision = previous ? previous.revision + 1 : 1;
    const inserted = id("review");
    getDb().transaction(() => {
      if (previous)
        getDb().prepare("UPDATE manual_reviews SET is_current=0 WHERE id=?").run(previous.id);
      getDb()
        .prepare(
          "INSERT INTO manual_reviews(id,result_node_id,review_context,reviewer,verdict,note,revision,supersedes_review_id,is_current,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          inserted,
          resultNodeId,
          context,
          reviewer,
          verdict,
          note,
          revision,
          previous?.id ?? null,
          1,
          new Date().toISOString(),
        );
    })();
    return NextResponse.json({ reviewId: inserted, reviewer, revision, verdict }, { status: 201 });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
