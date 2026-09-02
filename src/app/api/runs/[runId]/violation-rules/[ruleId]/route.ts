import { NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/access-control";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

export const dynamic = "force-dynamic";

function json(value: string | null | undefined, fallback: unknown) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function decodeRuleId(value: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new AppError("INVALID_INPUT", "规则 ID 无效", 400);
  }
  if (!decoded || decoded.length > 200 || decoded.includes("/")) {
    throw new AppError("INVALID_INPUT", "规则 ID 无效", 400);
  }
  return decoded;
}

const IMPACT_BY_RANK: Record<number, string | null> = {
  0: null,
  1: "minor",
  2: "moderate",
  3: "serious",
  4: "critical",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string; ruleId: string }> },
) {
  try {
    requireRequestRole(request, "admin");
    migrate();
    const { runId, ruleId: rawRuleId } = await context.params;
    const ruleId = decodeRuleId(rawRuleId);
    const db = getDb();
    if (!db.prepare("SELECT id FROM scan_runs WHERE id=?").get(runId)) {
      throw new AppError("NOT_FOUND", "扫描不存在", 404);
    }
    const rule = db
      .prepare(
        `
        SELECT rule_id, description, help, help_url, wcag_criteria_json,
               impact AS result_impact
        FROM rule_results
        WHERE run_id=? AND rule_id=? AND result_type='violation'
        ORDER BY page_id, id LIMIT 1
      `,
      )
      .get(runId, ruleId) as
      | {
          rule_id: string;
          description: string;
          help: string;
          help_url: string;
          wcag_criteria_json: string | null;
          result_impact: string | null;
        }
      | undefined;
    if (!rule) throw new AppError("NOT_FOUND", "规则不存在", 404);

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      throw new AppError("INVALID_PAGINATION", "分页参数无效", 400);
    }
    const totalRow = db
      .prepare(
        `
        SELECT COALESCE(SUM(node_count), 0) AS total
        FROM rule_results
        WHERE run_id=? AND rule_id=? AND result_type='violation'
      `,
      )
      .get(runId, ruleId) as { total: number };
    const nodeCount = Number(totalRow.total ?? 0);
    const evidenceTotalRow = db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id
        WHERE rr.run_id=? AND rr.rule_id=? AND rr.result_type='violation'
      `,
      )
      .get(runId, ruleId) as { total: number };
    const evidenceTotal = Number(evidenceTotalRow.total ?? 0);
    const pageCountRow = db
      .prepare(
        `SELECT COUNT(DISTINCT page_id) AS total FROM rule_results
         WHERE run_id=? AND rule_id=? AND result_type='violation'`,
      )
      .get(runId, ruleId) as { total: number };
    const pageCount = Number(pageCountRow.total ?? 0);
    const offset = (page - 1) * pageSize;
    const pageStatsRows = db
      .prepare(
        `
        SELECT p.id AS page_id,
               p.canonical_url,
               p.title,
               (SELECT COALESCE(SUM(rr2.node_count), 0)
                FROM rule_results rr2
                WHERE rr2.run_id=? AND rr2.rule_id=? AND rr2.result_type='violation'
                  AND rr2.page_id=p.id) AS node_count,
               MAX(CASE COALESCE(n.effective_impact, rr.impact)
                 WHEN 'critical' THEN 4
                 WHEN 'serious' THEN 3
                 WHEN 'moderate' THEN 2
                 WHEN 'minor' THEN 1
                 ELSE 0
               END) AS highest_impact_rank
        FROM result_nodes n
        JOIN rule_results rr ON rr.id=n.rule_result_id
        JOIN pages p ON p.id=rr.page_id
        WHERE rr.run_id=? AND rr.rule_id=? AND rr.result_type='violation'
        GROUP BY p.id, p.canonical_url, p.title
      `,
      )
      .all(runId, ruleId, runId, ruleId) as Array<{
      page_id: string;
      canonical_url: string;
      title: string | null;
      node_count: number;
      highest_impact_rank: number;
    }>;
    const pageStatsById = new Map(
      pageStatsRows.map((row) => [
        row.page_id,
        {
          nodeCount: Number(row.node_count ?? 0),
          highestImpact: IMPACT_BY_RANK[Number(row.highest_impact_rank ?? 0)] ?? null,
        },
      ]),
    );
    const nodeRows = db
      .prepare(
        `
        SELECT n.id, n.ordinal, n.target_json, n.html_sanitized, n.failure_summary,
               n.any_json, n.all_json, n.none_json, n.checks_json,
               n.effective_impact, rr.impact AS result_impact,
               p.id AS page_id, p.canonical_url, p.title
        FROM result_nodes n
        JOIN rule_results rr ON rr.id=n.rule_result_id
        JOIN pages p ON p.id=rr.page_id
        WHERE rr.run_id=? AND rr.rule_id=? AND rr.result_type='violation'
        ORDER BY p.canonical_url, p.id, n.ordinal, n.id
        LIMIT ? OFFSET ?
      `,
      )
      .all(runId, ruleId, pageSize, offset) as Array<{
      id: string;
      ordinal: number;
      target_json: string;
      html_sanitized: string;
      failure_summary: string | null;
      any_json: string;
      all_json: string;
      none_json: string;
      checks_json: string | null;
      effective_impact: string | null;
      result_impact: string | null;
      page_id: string;
      canonical_url: string;
      title: string | null;
    }>;

    const grouped = new Map<
      string,
      { pageId: string; page: { url: string; title: string | null }; nodes: any[] }
    >();
    for (const row of nodeRows) {
      let group = grouped.get(row.page_id);
      if (!group) {
        group = {
          pageId: row.page_id,
          page: { url: row.canonical_url, title: row.title },
          nodes: [],
        };
        grouped.set(row.page_id, group);
      }
      const checks = json(row.checks_json, {
        any: json(row.any_json, []),
        all: json(row.all_json, []),
        none: json(row.none_json, []),
      });
      group.nodes.push({
        id: row.id,
        ordinal: row.ordinal,
        impact: row.effective_impact ?? row.result_impact,
        target: json(row.target_json, [row.target_json]),
        html: row.html_sanitized,
        failureSummary: row.failure_summary,
        checks,
      });
    }
    const pages = [...grouped.values()].map(({ pageId, ...group }) => {
      const stats = pageStatsById.get(pageId);
      return {
        ...group.page,
        id: pageId,
        url: group.page.url,
        canonicalUrl: group.page.url,
        highestImpact: stats?.highestImpact ?? null,
        nodeCount: stats?.nodeCount ?? 0,
        nodes: group.nodes,
      };
    });
    const highestImpactRank = pageStatsRows.reduce(
      (highest, row) => Math.max(highest, Number(row.highest_impact_rank ?? 0)),
      0,
    );
    return NextResponse.json({
      runId,
      rule: {
        id: rule.rule_id,
        description: rule.description,
        help: rule.help,
        helpUrl: rule.help_url,
        wcag: json(rule.wcag_criteria_json, []),
        highestImpact: IMPACT_BY_RANK[highestImpactRank],
        pageCount,
        nodeCount,
      },
      pages,
      pagination: {
        page,
        pageSize,
        evidenceTotal,
        totalPages: Math.ceil(evidenceTotal / pageSize),
        hasMore: offset + nodeRows.length < evidenceTotal,
        nextPage: offset + nodeRows.length < evidenceTotal ? page + 1 : null,
      },
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
