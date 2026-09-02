import { NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/access-control";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";

export const dynamic = "force-dynamic";

const IMPACT_RANK: Record<string, number> = {
  minor: 1,
  moderate: 2,
  serious: 3,
  critical: 4,
};

function json(value: string | null | undefined, fallback: unknown) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function highestImpact(current: string | null, next: string | null) {
  return (IMPACT_RANK[next ?? ""] ?? 0) > (IMPACT_RANK[current ?? ""] ?? 0) ? next : current;
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    requireRequestRole(request, "admin");
    migrate();
    const { runId } = await context.params;
    const db = getDb();
    if (!db.prepare("SELECT id FROM scan_runs WHERE id=?").get(runId)) {
      throw new AppError("NOT_FOUND", "扫描不存在", 404);
    }

    // This query deliberately returns rule-result and node impact columns only.
    // Node evidence is loaded by the detail route after a rule is expanded.
    const rows = db
      .prepare(
        `
        SELECT rr.rule_id, rr.description, rr.help, rr.help_url, rr.wcag_criteria_json,
               rr.impact AS result_impact, rr.page_id, rr.id AS result_id,
               rr.node_count AS result_node_count, n.effective_impact, n.id AS node_id
        FROM rule_results rr
        LEFT JOIN result_nodes n ON n.rule_result_id=rr.id
        WHERE rr.run_id=? AND rr.result_type='violation'
        ORDER BY rr.rule_id, rr.page_id, n.ordinal, n.id
      `,
      )
      .all(runId) as Array<{
      rule_id: string;
      description: string;
      help: string;
      help_url: string;
      wcag_criteria_json: string | null;
      result_impact: string | null;
      page_id: string;
      result_id: string;
      result_node_count: number;
      effective_impact: string | null;
      node_id: string | null;
    }>;

    const grouped = new Map<
      string,
      {
        ruleId: string;
        description: string;
        help: string;
        helpUrl: string;
        wcag: unknown;
        highestImpact: string | null;
        affectedPageCount: number;
        nodeCount: number;
        pages: Set<string>;
        resultIds: Set<string>;
      }
    >();
    for (const row of rows) {
      let item = grouped.get(row.rule_id);
      if (!item) {
        item = {
          ruleId: row.rule_id,
          description: row.description,
          help: row.help,
          helpUrl: row.help_url,
          wcag: json(row.wcag_criteria_json, []),
          highestImpact: null,
          affectedPageCount: 0,
          nodeCount: 0,
          pages: new Set(),
          resultIds: new Set(),
        };
        grouped.set(row.rule_id, item);
      }
      item.pages.add(row.page_id);
      item.highestImpact = highestImpact(
        item.highestImpact,
        row.effective_impact ?? row.result_impact,
      );
      if (!item.resultIds.has(row.result_id)) {
        item.resultIds.add(row.result_id);
        item.nodeCount += Number(row.result_node_count ?? 0);
      }
    }

    const rules = [...grouped.values()]
      .map(({ pages, resultIds: _resultIds, ...item }) => {
        const affectedPageCount = pages.size;
        return {
          id: item.ruleId,
          description: item.description,
          help: item.help,
          helpUrl: item.helpUrl,
          wcag: item.wcag,
          highestImpact: item.highestImpact,
          pageCount: affectedPageCount,
          nodeCount: item.nodeCount,
        };
      })
      .sort(
        (a, b) =>
          (IMPACT_RANK[b.highestImpact ?? ""] ?? 0) - (IMPACT_RANK[a.highestImpact ?? ""] ?? 0) ||
          b.nodeCount - a.nodeCount ||
          a.id.localeCompare(b.id),
      );
    return NextResponse.json({ runId, rules, total: rules.length });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error, request), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
