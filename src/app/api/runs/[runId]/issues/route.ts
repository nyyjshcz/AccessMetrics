import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { catalogEntryWithTags } from "@/lib/wcag";
import { getRuleLocalization } from "@/lib/localization";
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    migrate();
    const session = await currentSession();
    const { runId } = await context.params;
    const run = getDb().prepare("SELECT published FROM scan_runs WHERE id=?").get(runId) as
      | { published: number }
      | undefined;
    if (!run || (!session && !run.published)) throw new AppError("NOT_FOUND", "扫描不存在", 404);
    const url = new URL(request.url);
    const allowedParams = new Set([
      "page",
      "pageSize",
      "pageId",
      "principle",
      "impact",
      "ruleId",
      "resultType",
      "reviewVerdict",
      "sort",
    ]);
    for (const key of url.searchParams.keys())
      if (!allowedParams.has(key))
        throw new AppError("VALIDATION_ERROR", `未知查询参数：${key}`, 400);
    const page = Number(url.searchParams.get("page") ?? 1);
    const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new AppError("VALIDATION_ERROR", "page/pageSize 参数无效", 400);
    const resultType = url.searchParams.get("resultType") ?? "violation";
    if (!["violation", "incomplete", "pass"].includes(resultType))
      throw new AppError("VALIDATION_ERROR", "resultType 参数无效", 400);
    const principle = url.searchParams.get("principle");
    if (principle && !["perceivable", "operable", "understandable", "robust"].includes(principle))
      throw new AppError("VALIDATION_ERROR", "principle 参数无效", 400);
    const impactFilter = url.searchParams.get("impact");
    if (impactFilter && !["critical", "serious", "moderate", "minor"].includes(impactFilter))
      throw new AppError("VALIDATION_ERROR", "impact 参数无效", 400);
    const reviewVerdict = url.searchParams.get("reviewVerdict");
    if (
      reviewVerdict &&
      !["confirmed", "not_an_issue", "uncertain", "unreviewed"].includes(reviewVerdict)
    )
      throw new AppError("VALIDATION_ERROR", "reviewVerdict 参数无效", 400);
    const sort = url.searchParams.get("sort") ?? "impact_desc";
    if (!["impact_desc", "page_asc", "rule_asc"].includes(sort))
      throw new AppError("VALIDATION_ERROR", "sort 参数无效", 400);
    const where = ["rr.run_id=?", "rr.result_type=?"];
    const args: any[] = [runId, resultType];
    const pageId = url.searchParams.get("pageId");
    if (pageId) {
      where.push("rr.page_id=?");
      args.push(pageId);
    }
    const ruleId = url.searchParams.get("ruleId");
    if (ruleId) {
      where.push("rr.rule_id=?");
      args.push(ruleId);
    }
    if (impactFilter) {
      where.push("rr.impact=?");
      args.push(impactFilter);
    }
    const rows = getDb()
      .prepare(
        `SELECT rr.id,rr.page_id,rr.rule_id,rr.result_type,rr.impact,rr.description,rr.help,rr.help_url,rr.node_count,rr.tags_json,rr.principles_json,(SELECT n.id FROM result_nodes n WHERE n.rule_result_id=rr.id ORDER BY n.ordinal LIMIT 1) result_node_id,(SELECT mr.verdict FROM manual_reviews mr WHERE mr.result_node_id IN (SELECT n2.id FROM result_nodes n2 WHERE n2.rule_result_id=rr.id) AND mr.is_current=1 ORDER BY mr.reviewed_at DESC LIMIT 1) review_verdict FROM rule_results rr WHERE ${where.join(" AND ")}`,
      )
      .all(...args) as any[];
    const filtered = rows
      .map((row) => {
        const tags = JSON.parse(row.tags_json ?? "[]") as string[];
        const entry = catalogEntryWithTags(row.rule_id, tags);
        const principles = JSON.parse(row.principles_json ?? "null") ?? entry.principles;
        return {
          ...row,
          principles,
          localization: getRuleLocalization(row.rule_id),
          reviewVerdict: row.review_verdict ?? "unreviewed",
        };
      })
      .filter((row) => !principle || row.principles.includes(principle))
      .filter((row) => !reviewVerdict || row.reviewVerdict === reviewVerdict)
      .sort((a, b) => {
        if (sort === "rule_asc")
          return a.rule_id.localeCompare(b.rule_id) || a.page_id.localeCompare(b.page_id);
        if (sort === "page_asc")
          return a.page_id.localeCompare(b.page_id) || a.rule_id.localeCompare(b.rule_id);
        const impactOrder: Record<string, number> = {
          critical: 1,
          serious: 2,
          moderate: 3,
          minor: 4,
        };
        return (
          (impactOrder[a.impact] ?? 5) - (impactOrder[b.impact] ?? 5) ||
          a.page_id.localeCompare(b.page_id) ||
          a.rule_id.localeCompare(b.rule_id)
        );
      });
    const total = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);
    return NextResponse.json({
      items,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
