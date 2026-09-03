import { getDb } from "./db";
import { buildRunScore } from "./run-score";
import { loadAiOverlayForRun, type AiVerdict } from "./ai-overlay";
import {
  applyHumanPrecedence,
  loadLocalManualVerdicts,
  type ResolutionVerdict,
} from "./incomplete-resolution";

export type NodeResolutionSource = "manual" | "ai" | "raw";

/** Effective conclusion for one incomplete node: human local/ad_hoc > AI > raw incomplete. */
export type NodeResolution = {
  verdict: ResolutionVerdict | null; // null means the node is still an unresolved raw incomplete
  source: NodeResolutionSource;
};

export type IncompleteResolutionSummary = {
  total: number;
  manual: Record<ResolutionVerdict, number>;
  ai: Record<ResolutionVerdict, number>;
  unresolved: number;
};

function emptyVerdictCounts(): Record<ResolutionVerdict, number> {
  return { problem: 0, not_problem: 0, uncertain: 0 };
}

export function nodeResolution(
  nodeId: string,
  resultType: string,
  manualVerdicts: ReadonlyMap<string, ResolutionVerdict>,
  aiVerdicts: ReadonlyMap<string, AiVerdict>,
): NodeResolution | null {
  if (resultType !== "incomplete") return null;
  const manual = manualVerdicts.get(nodeId);
  if (manual) return { verdict: manual, source: "manual" };
  const ai = aiVerdicts.get(nodeId);
  if (ai) return { verdict: ai, source: "ai" };
  return { verdict: null, source: "raw" };
}

export type AuthorizedRunReportDto = {
  runId: string;
  site: { name: string; origin: string };
  run: {
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string | null;
  };
  score: ReturnType<typeof buildRunScore>;
  resolvedScore: ReturnType<typeof buildRunScore>;
  generatedAt: string;
  pages: Array<{
    canonicalUrl: string;
    scanStatus: string;
    httpStatus: number | null;
    errorCode: string | null;
    frameCoverageStatus: string | null;
  }>;
  nodeStatistics: {
    total: number;
    pass: number;
    violation: number;
    incomplete: number;
    inapplicable: number;
  };
  issues: Array<{
    id: string;
    ruleId: string;
    impact: string | null;
    resultType: string;
    description: string;
    help: string;
    helpUrl: string;
    nodeCount: number;
    nodes: Array<{
      ordinal: number;
      pageUrl: string;
      target: unknown;
      html: string;
      failureSummary: string | null;
      framePath: unknown;
      resolution: NodeResolution | null;
    }>;
  }>;
  incompleteResolutions: IncompleteResolutionSummary;
};

/** Canonical data contract consumed by the web, HTML, and PDF report views. */
export type ReportModel = AuthorizedRunReportDto;

function sumVerdicts(counts: Record<ResolutionVerdict, number>) {
  return counts.problem + counts.not_problem + counts.uncertain;
}

export function buildRunReportDto(runId: string): AuthorizedRunReportDto {
  const run = getDb()
    .prepare(
      "SELECT r.id,r.status,r.started_at,r.finished_at,r.created_at,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
    )
    .get(runId) as
    | {
        id: string;
        status: string;
        started_at: string | null;
        finished_at: string | null;
        created_at: string | null;
        origin: string;
        name: string;
      }
    | undefined;
  if (!run) throw new Error("run not found");
  const aiVerdicts = loadAiOverlayForRun(runId);
  const manualVerdicts = loadLocalManualVerdicts(runId);
  // The report's effective conclusion is deliberately local/ad_hoc human
  // decision first, then completed AI, then the original incomplete result.
  const effectiveVerdicts = applyHumanPrecedence(aiVerdicts, manualVerdicts);
  const score = buildRunScore(runId);
  const resolvedScore = buildRunScore(runId, { aiOverlay: effectiveVerdicts });
  const pages = getDb()
    .prepare(
      "SELECT canonical_url,scan_status,http_status,error_code,frame_coverage_status FROM pages WHERE run_id=? ORDER BY canonical_url",
    )
    .all(runId) as Array<{
    canonical_url: string;
    scan_status: string;
    http_status: number | null;
    error_code: string | null;
    frame_coverage_status: string | null;
  }>;
  const issues = getDb()
    .prepare(
      "SELECT id,rule_id,impact,result_type,description,help,help_url,node_count FROM rule_results WHERE run_id=? ORDER BY CASE impact WHEN 'critical' THEN 1 WHEN 'serious' THEN 2 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 ELSE 5 END,rule_id,result_type",
    )
    .all(runId) as Array<{
    id: string;
    rule_id: string;
    impact: string | null;
    result_type: string;
    description: string;
    help: string;
    help_url: string;
    node_count: number;
  }>;
  const issueNodes = new Map<
    string,
    Array<{
      ordinal: number;
      pageUrl: string;
      target: unknown;
      html: string;
      failureSummary: string | null;
      framePath: unknown;
      nodeId: string;
    }>
  >();
  const issueIds = issues.map((issue) => issue.id);
  if (issueIds.length > 0) {
    const nodeRows = getDb()
      .prepare(
        `SELECT rn.id AS node_id,rn.rule_result_id,rn.ordinal,rn.target_json,rn.html_sanitized,rn.failure_summary,rn.frame_path_json,p.canonical_url FROM result_nodes rn JOIN pages p ON p.id=(SELECT page_id FROM rule_results WHERE id=rn.rule_result_id) WHERE rn.rule_result_id IN (${issueIds.map(() => "?").join(",")}) ORDER BY rn.rule_result_id,rn.ordinal`,
      )
      .all(...issueIds) as Array<{
      rule_result_id: string;
      node_id: string;
      ordinal: number;
      target_json: string;
      html_sanitized: string;
      failure_summary: string | null;
      frame_path_json: string | null;
      canonical_url: string;
    }>;
    for (const node of nodeRows) {
      let target: unknown = node.target_json;
      let framePath: unknown = [];
      try {
        target = JSON.parse(node.target_json);
      } catch {
        // Preserve malformed legacy evidence as text instead of failing report generation.
      }
      if (node.frame_path_json) {
        try {
          framePath = JSON.parse(node.frame_path_json);
        } catch {
          framePath = [];
        }
      }
      const list = issueNodes.get(node.rule_result_id) ?? [];
      list.push({
        ordinal: node.ordinal,
        nodeId: node.node_id,
        pageUrl: node.canonical_url,
        target,
        html: node.html_sanitized,
        failureSummary: node.failure_summary,
        framePath,
      });
      issueNodes.set(node.rule_result_id, list);
    }
  }
  const nodeCounts = getDb()
    .prepare(
      `SELECT rr.result_type,SUM(rr.node_count) AS count
       FROM rule_results rr
       WHERE rr.run_id=? GROUP BY rr.result_type`,
    )
    .all(runId) as Array<{ result_type: string; count: number }>;
  const nodeStatistics = { total: 0, pass: 0, violation: 0, incomplete: 0, inapplicable: 0 };
  for (const row of nodeCounts) {
    const count = Number(row.count) || 0;
    if (row.result_type in nodeStatistics && row.result_type !== "total")
      nodeStatistics[row.result_type as keyof Omit<typeof nodeStatistics, "total">] += count;
  }
  nodeStatistics.total = Object.entries(nodeStatistics)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, count]) => sum + count, 0);
  const incompleteResolutions: IncompleteResolutionSummary = {
    total: nodeStatistics.incomplete,
    manual: emptyVerdictCounts(),
    ai: emptyVerdictCounts(),
    unresolved: 0,
  };
  for (const issue of issues) {
    if (issue.result_type !== "incomplete") continue;
    const nodes = issueNodes.get(issue.id) ?? [];
    for (const node of nodes) {
      const resolution = nodeResolution(node.nodeId, issue.result_type, manualVerdicts, aiVerdicts);
      if (!resolution || resolution.source === "raw") incompleteResolutions.unresolved++;
      else incompleteResolutions[resolution.source][resolution.verdict!]++;
    }
    // A rule result can report nodes whose evidence was not persisted (for
    // example after a partial write). Those nodes are still review items;
    // never silently turn missing evidence into a reviewed result.
    const missingEvidence = Math.max(0, Number(issue.node_count) - nodes.length);
    incompleteResolutions.unresolved += missingEvidence;
  }
  // Keep the summary arithmetic explicit even when older data has inconsistent
  // node_count values. Every incomplete node is either concluded or unresolved.
  const classified = sumVerdicts(incompleteResolutions.manual) + sumVerdicts(incompleteResolutions.ai) + incompleteResolutions.unresolved;
  if (classified < incompleteResolutions.total) {
    incompleteResolutions.unresolved += incompleteResolutions.total - classified;
  }
  return {
    runId,
    site: { name: run.name, origin: run.origin },
    run: {
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      createdAt: run.created_at,
    },
    score,
    resolvedScore,
    generatedAt: new Date().toISOString(),
    pages: pages.map((page) => ({
      canonicalUrl: page.canonical_url,
      scanStatus: page.scan_status,
      httpStatus: page.http_status,
      errorCode: page.error_code,
      frameCoverageStatus: page.frame_coverage_status,
    })),
    issues: issues.map((issue) => ({
      id: issue.id,
      ruleId: issue.rule_id,
      impact: issue.impact,
      resultType: issue.result_type,
      description: issue.description,
      help: issue.help,
      helpUrl: issue.help_url,
      nodeCount: Math.max(0, Number(issue.node_count) || 0),
      nodes: (issueNodes.get(issue.id) ?? []).map((node) => ({
        ordinal: node.ordinal,
        pageUrl: node.pageUrl,
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
        framePath: node.framePath,
        resolution: nodeResolution(node.nodeId, issue.result_type, manualVerdicts, aiVerdicts),
      })),
    })),
    nodeStatistics,
    incompleteResolutions,
  };
}
