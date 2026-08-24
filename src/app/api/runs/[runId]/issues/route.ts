import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { catalogEntryWithTags } from "@/lib/wcag";
import { getRuleLocalization } from "@/lib/localization";
import { aiImpactForResolvedIncomplete, type AiVerdict } from "@/lib/ai-overlay";
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
    if (!["violation", "incomplete", "pass", "inapplicable"].includes(resultType))
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
        `SELECT rr.id,rr.page_id,rr.rule_id,rr.result_type,rr.impact,rr.description,rr.help,rr.help_url,rr.node_count,rr.tags_json,rr.principles_json,
                p.canonical_url page_url,p.title page_title,
                (SELECT n.id FROM result_nodes n WHERE n.rule_result_id=rr.id ORDER BY n.ordinal LIMIT 1) result_node_id
           FROM rule_results rr JOIN pages p ON p.id=rr.page_id
          WHERE ${where.join(" AND ")}`,
      )
      .all(...args) as any[];
    const coverageByResult = new Map<
      string,
      {
        reviewedNodeCount: number;
        confirmedCount: number;
        notAnIssueCount: number;
        uncertainCount: number;
      }
    >();
    if (rows.length) {
      const coverageRows = getDb()
        .prepare(
          `SELECT n.rule_result_id,
                  COUNT(DISTINCT CASE WHEN mr.id IS NOT NULL THEN n.id END) reviewed_node_count,
                  COUNT(DISTINCT CASE WHEN mr.verdict='confirmed' THEN n.id END) confirmed_count,
                  COUNT(DISTINCT CASE WHEN mr.verdict='not_an_issue' THEN n.id END) not_an_issue_count,
                  COUNT(DISTINCT CASE WHEN mr.verdict='uncertain' THEN n.id END) uncertain_count
             FROM result_nodes n
             LEFT JOIN manual_reviews mr ON mr.result_node_id=n.id AND mr.review_context='ad_hoc' AND mr.is_current=1
            WHERE n.rule_result_id IN (${rows.map(() => "?").join(",")})
            GROUP BY n.rule_result_id`,
        )
        .all(...rows.map((row) => row.id)) as Array<{
        rule_result_id: string;
        reviewed_node_count: number;
        confirmed_count: number;
        not_an_issue_count: number;
        uncertain_count: number;
      }>;
      for (const row of coverageRows)
        coverageByResult.set(row.rule_result_id, {
          reviewedNodeCount: Number(row.reviewed_node_count ?? 0),
          confirmedCount: Number(row.confirmed_count ?? 0),
          notAnIssueCount: Number(row.not_an_issue_count ?? 0),
          uncertainCount: Number(row.uncertain_count ?? 0),
        });
    }
    const filtered = rows
      .map((row) => {
        const tags = JSON.parse(row.tags_json ?? "[]") as string[];
        const entry = catalogEntryWithTags(row.rule_id, tags);
        const principles = JSON.parse(row.principles_json ?? "null") ?? entry.principles;
        return {
          ...row,
          principles,
          localization: getRuleLocalization(row.rule_id),
          reviewCoverage: coverageByResult.get(row.id) ?? {
            reviewedNodeCount: 0,
            confirmedCount: 0,
            notAnIssueCount: 0,
            uncertainCount: 0,
          },
        };
      })
      .filter((row) => !principle || row.principles.includes(principle))
      .filter((row) => {
        if (!reviewVerdict) return true;
        if (reviewVerdict === "unreviewed") return row.reviewCoverage.reviewedNodeCount === 0;
        if (reviewVerdict === "confirmed") return row.reviewCoverage.confirmedCount > 0;
        if (reviewVerdict === "not_an_issue") return row.reviewCoverage.notAnIssueCount > 0;
        return row.reviewCoverage.uncertainCount > 0;
      })
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
    const nodeRows = items.length
      ? (getDb()
          .prepare(
            `SELECT id,rule_result_id,ordinal,target_json,html_sanitized,failure_summary,frame_path_json,frame_url,frame_origin_relation,target_hash,impact,effective_impact,severity_weight,severity_source,ai_evidence_json FROM result_nodes WHERE rule_result_id IN (${items.map(() => "?").join(",")}) ORDER BY rule_result_id,ordinal`,
          )
          .all(...items.map((item) => item.id)) as Array<{
          id: string;
          rule_result_id: string;
          ordinal: number;
          target_json: string;
          html_sanitized: string;
          failure_summary: string | null;
          frame_path_json: string | null;
          frame_url: string | null;
          frame_origin_relation: string | null;
          target_hash: string | null;
          impact: string | null;
          effective_impact: string | null;
          severity_weight: number | null;
          severity_source: string | null;
          ai_evidence_json: string | null;
        }>)
      : [];
    const aiByNode = new Map<
      string,
      { verdict: AiVerdict; reason: string | null; updated_at: string }
    >();
    if (session && nodeRows.length) {
      const aiRows = getDb()
        .prepare(
          `SELECT i.result_node_id,i.verdict,i.reason,i.updated_at
             FROM ai_review_items i
             JOIN ai_review_batches b ON b.id=i.batch_id
            WHERE i.result_node_id IN (${nodeRows.map(() => "?").join(",")})
              AND i.status='completed' AND i.verdict IS NOT NULL
            ORDER BY i.updated_at DESC,i.id DESC`,
        )
        .all(...nodeRows.map((node) => node.id)) as Array<{
        result_node_id: string;
        verdict: AiVerdict;
        reason: string | null;
        updated_at: string;
      }>;
      for (const row of aiRows)
        if (!aiByNode.has(row.result_node_id)) aiByNode.set(row.result_node_id, row);
    }
    const nodesByResult = new Map<string, unknown[]>();
    const itemByResult = new Map(items.map((item) => [item.id, item]));
    for (const node of nodeRows) {
      const target = (() => {
        try {
          return JSON.parse(node.target_json);
        } catch {
          return [node.target_json];
        }
      })();
      const framePath = node.frame_path_json
        ? (() => {
            try {
              return JSON.parse(node.frame_path_json as string);
            } catch {
              return [];
            }
          })()
        : [];
      const list = nodesByResult.get(node.rule_result_id) ?? [];
      list.push({
        id: node.id,
        ordinal: node.ordinal,
        target,
        html: node.html_sanitized,
        failureSummary: node.failure_summary,
        framePath,
        frameUrl: node.frame_url,
        frameOriginRelation: node.frame_origin_relation,
        targetHash: node.target_hash,
        impact: node.impact,
        effectiveImpact: node.effective_impact,
        severityWeight: node.severity_weight,
        severitySource: node.severity_source,
        ...(session
          ? {
              aiEvidence: node.ai_evidence_json
                ? (() => {
                    try {
                      return JSON.parse(node.ai_evidence_json);
                    } catch {
                      return null;
                    }
                  })()
                : null,
              aiReview: (() => {
                const review = aiByNode.get(node.id);
                if (!review) return null;
                return {
                  verdict: review.verdict,
                  reason: review.reason,
                  impact:
                    review.verdict === "problem"
                      ? aiImpactForResolvedIncomplete(node, {
                          impact: itemByResult.get(node.rule_result_id)?.impact,
                        })
                      : null,
                  updatedAt: review.updated_at,
                };
              })(),
            }
          : {}),
      });
      nodesByResult.set(node.rule_result_id, list);
    }
    return NextResponse.json({
      items: items.map((item) => ({ ...item, nodes: nodesByResult.get(item.id) ?? [] })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
