import { getDb } from "./db";
import { catalogEntryWithTags, classifyImpact } from "./wcag";
import {
  exactBreakdown,
  IMPACT_ORDINAL_WEIGHTS,
  roundHalfUpTenths,
  SCORE_MODEL_VERSION,
  type ScoreOpportunity,
} from "./score";
import { aiImpactForResolvedIncomplete, type AiOverlay } from "./ai-overlay";

function impactWeight(impact: ScoreOpportunity["impact"]): number {
  return impact ? IMPACT_ORDINAL_WEIGHTS[impact] : 0;
}

type OpportunityRow = {
  node_id: string | null;
  result_type: string;
  impact: string | null;
  rule_id: string;
  node_count: number;
  principles_json: string | null;
  scoring_eligible: number;
  effective_impact: string | null;
};
type RuleRow = Omit<OpportunityRow, "node_id" | "effective_impact"> & {
  rule_result_id: string;
};
type NodeRow = {
  node_id: string;
  rule_result_id: string;
  effective_impact: string | null;
};

function loadOpportunityRows(runId: string, pageId?: string): OpportunityRow[] {
  const filter = pageId ? "rr.run_id=? AND rr.page_id=?" : "rr.run_id=?";
  const params = pageId ? [runId, pageId] : [runId];
  const db = getDb();
  const rules = db
    .prepare(
      `SELECT rr.id AS rule_result_id,rr.result_type,rr.impact,rr.rule_id,rr.node_count,rr.principles_json,rr.scoring_eligible
       FROM rule_results rr WHERE ${filter} ORDER BY rr.id`,
    )
    .all(...params) as RuleRow[];
  const nodes = db
    .prepare(
      `SELECT n.id AS node_id,n.rule_result_id,n.effective_impact,n.ordinal
       FROM result_nodes n JOIN rule_results rr ON rr.id=n.rule_result_id
       WHERE ${filter} ORDER BY n.rule_result_id,n.ordinal`,
    )
    .all(...params) as NodeRow[];
  const nodesByRule = new Map<string, NodeRow[]>();
  for (const node of nodes) {
    const list = nodesByRule.get(node.rule_result_id);
    if (list) list.push(node);
    else nodesByRule.set(node.rule_result_id, [node]);
  }
  return rules.flatMap((rule): OpportunityRow[] => {
    const ruleNodes = nodesByRule.get(rule.rule_result_id);
    if (!ruleNodes?.length)
      return [
        {
          ...rule,
          node_id: null,
          effective_impact: null,
        },
      ];
    return ruleNodes.map((node) => ({
      ...rule,
      node_id: node.node_id,
      effective_impact: node.effective_impact,
    }));
  });
}

const PRINCIPLES = new Set(["perceivable", "operable", "understandable", "robust"]);
function frozenPrinciples(value: unknown): ScoreOpportunity["principles"] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is NonNullable<ScoreOpportunity["principles"]>[number] =>
          PRINCIPLES.has(item),
        )
      : [];
  } catch {
    return [];
  }
}

export function loadRunOpportunities(
  runId: string,
  options?: { aiOverlay?: AiOverlay },
): ScoreOpportunity[] {
  const rows = loadOpportunityRows(runId);
  const opportunities: ScoreOpportunity[] = [];
  for (const row of rows) {
    // Pass nodes are intentionally not persisted (their raw rule result still
    // carries the node count), so retain the original rule-level pass scoring
    // while keeping violations and resolved incomplete results node-based.
    // This is also important for raw scores: an axe pass with no stored node
    // must still be a judged opportunity.
    if (row.result_type !== "pass" && !row.node_id) continue;
    const overlayVerdict =
      row.result_type === "incomplete" && row.node_id
        ? options?.aiOverlay?.get(String(row.node_id))
        : undefined;
    const resolvedType =
      overlayVerdict === "problem"
        ? "violation"
        : overlayVerdict === "not_problem"
          ? "pass"
          : overlayVerdict === "uncertain"
            ? "incomplete"
            : row.result_type;
    if (resolvedType !== "pass" && resolvedType !== "violation") continue;
    if (Number(row.scoring_eligible) !== 1) continue;
    const resolvedIncomplete =
      row.result_type === "incomplete" &&
      (overlayVerdict === "problem" || overlayVerdict === "not_problem");
    const impacts = resolvedIncomplete
      ? [aiImpactForResolvedIncomplete(row, { impact: row.impact })]
      : resolvedType === "pass" && !row.node_id
        ? Array.from({ length: Math.max(0, Number(row.node_count) || 0) }, () =>
            classifyImpact(row.impact),
          )
        : [
            resolvedType === "violation"
              ? (classifyImpact(row.effective_impact ?? row.impact) ?? "minor")
              : classifyImpact(row.impact),
          ];
    for (const impact of impacts)
      opportunities.push({
        passed: resolvedType === "pass",
        impact: classifyImpact(impact),
        // Keep one opportunity per rule node. A rule may map to several
        // principles, but it must only count once in the overall score.
        principles: frozenPrinciples(row.principles_json),
      });
  }
  return opportunities;
}
export function loadPageOpportunities(
  runId: string,
  pageId: string,
  options?: { aiOverlay?: AiOverlay },
): ScoreOpportunity[] {
  const rows = loadOpportunityRows(runId, pageId);
  const opportunities: ScoreOpportunity[] = [];
  for (const row of rows) {
    if (row.result_type !== "pass" && !row.node_id) continue;
    const overlayVerdict =
      row.result_type === "incomplete" && row.node_id
        ? options?.aiOverlay?.get(String(row.node_id))
        : undefined;
    const resolvedType =
      overlayVerdict === "problem"
        ? "violation"
        : overlayVerdict === "not_problem"
          ? "pass"
          : overlayVerdict === "uncertain"
            ? "incomplete"
            : row.result_type;
    if (resolvedType !== "pass" && resolvedType !== "violation") continue;
    if (Number(row.scoring_eligible) !== 1) continue;
    const resolvedIncomplete =
      row.result_type === "incomplete" &&
      (overlayVerdict === "problem" || overlayVerdict === "not_problem");
    const impacts = resolvedIncomplete
      ? [aiImpactForResolvedIncomplete(row, { impact: row.impact })]
      : resolvedType === "pass" && !row.node_id
        ? Array.from({ length: Math.max(0, Number(row.node_count) || 0) }, () =>
            classifyImpact(row.impact),
          )
        : [
            resolvedType === "violation"
              ? (classifyImpact(row.effective_impact ?? row.impact) ?? "minor")
              : classifyImpact(row.impact),
          ];
    for (const impact of impacts)
      opportunities.push({
        passed: resolvedType === "pass",
        impact: classifyImpact(impact),
        principles: frozenPrinciples(row.principles_json),
      });
  }
  return opportunities;
}
export function persistRunScores(runId: string) {
  const db = getDb();
  const runPages = db
    .prepare("SELECT DISTINCT page_id FROM rule_results WHERE run_id=? ORDER BY page_id")
    .all(runId) as any[];
  for (const row of runPages) {
    const opportunities = loadPageOpportunities(runId, row.page_id);
    const exact = exactBreakdown(opportunities);
    const value = (score: typeof exact.overall) =>
      score ? { num: Number(score.numerator), den: Number(score.denominator) } : { num: 0, den: 0 };
    const displayFields = (score: typeof exact.overall) => {
      const display = roundHalfUpTenths(score);
      return {
        score: display,
        tenths: display === null ? null : Math.round(display * 10),
        numerator: score ? Number(score.numerator) : null,
        denominator: score ? Number(score.denominator) : null,
      };
    };
    const all = value(exact.overall),
      p = value(exact.perceivable),
      o = value(exact.operable),
      u = value(exact.understandable),
      r = value(exact.robust);
    const allFields = displayFields(exact.overall),
      pFields = displayFields(exact.perceivable),
      oFields = displayFields(exact.operable),
      uFields = displayFields(exact.understandable),
      rFields = displayFields(exact.robust);
    db.prepare(
      "INSERT OR REPLACE INTO page_scores(id,run_id,page_id,perceivable_num,perceivable_den,operable_num,operable_den,understandable_num,understandable_den,robust_num,robust_den,overall_num,overall_den,weighted_defects,total_violations,model_version,total_score,total_score_tenths,total_numerator,total_denominator,perceivable_score,perceivable_score_tenths,perceivable_numerator,perceivable_denominator,operable_score,operable_score_tenths,operable_numerator,operable_denominator,understandable_score,understandable_score_tenths,understandable_numerator,understandable_denominator,robust_score,robust_score_tenths,robust_numerator,robust_denominator,score_details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      `ps_${runId}_${row.page_id}`,
      runId,
      row.page_id,
      p.num,
      p.den,
      o.num,
      o.den,
      u.num,
      u.den,
      r.num,
      r.den,
      all.num,
      all.den,
      opportunities.reduce((sum, item) => sum + (item.passed ? 0 : impactWeight(item.impact)), 0),
      opportunities.filter((item) => !item.passed).length,
      SCORE_MODEL_VERSION,
      allFields.score,
      allFields.tenths,
      allFields.numerator,
      allFields.denominator,
      pFields.score,
      pFields.tenths,
      pFields.numerator,
      pFields.denominator,
      oFields.score,
      oFields.tenths,
      oFields.numerator,
      oFields.denominator,
      uFields.score,
      uFields.tenths,
      uFields.numerator,
      uFields.denominator,
      rFields.score,
      rFields.tenths,
      rFields.numerator,
      rFields.denominator,
      JSON.stringify(serializeExactBreakdown(exact)),
      new Date().toISOString(),
    );
  }
  const runOpportunities = loadRunOpportunities(runId);
  const runExact = exactBreakdown(runOpportunities);
  const value = (score: typeof runExact.overall) =>
    score ? { num: Number(score.numerator), den: Number(score.denominator) } : { num: 0, den: 0 };
  const displayFields = (score: typeof runExact.overall) => {
    const display = roundHalfUpTenths(score);
    return {
      score: display,
      tenths: display === null ? null : Math.round(display * 10),
      numerator: score ? Number(score.numerator) : null,
      denominator: score ? Number(score.denominator) : null,
    };
  };
  const all = value(runExact.overall),
    p = value(runExact.perceivable),
    o = value(runExact.operable),
    u = value(runExact.understandable),
    r = value(runExact.robust);
  const allFields = displayFields(runExact.overall),
    pFields = displayFields(runExact.perceivable),
    oFields = displayFields(runExact.operable),
    uFields = displayFields(runExact.understandable),
    rFields = displayFields(runExact.robust);
  db.prepare(
    "INSERT OR REPLACE INTO site_scores(id,run_id,perceivable_num,perceivable_den,operable_num,operable_den,understandable_num,understandable_den,robust_num,robust_den,overall_num,overall_den,page_count,model_version,total_score,total_score_tenths,total_numerator,total_denominator,perceivable_score,perceivable_score_tenths,perceivable_numerator,perceivable_denominator,operable_score,operable_score_tenths,operable_numerator,operable_denominator,understandable_score,understandable_score_tenths,understandable_numerator,understandable_denominator,robust_score,robust_score_tenths,robust_numerator,robust_denominator,score_details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    `ss_${runId}`,
    runId,
    p.num,
    p.den,
    o.num,
    o.den,
    u.num,
    u.den,
    r.num,
    r.den,
    all.num,
    all.den,
    runPages.length,
    SCORE_MODEL_VERSION,
    allFields.score,
    allFields.tenths,
    allFields.numerator,
    allFields.denominator,
    pFields.score,
    pFields.tenths,
    pFields.numerator,
    pFields.denominator,
    oFields.score,
    oFields.tenths,
    oFields.numerator,
    oFields.denominator,
    uFields.score,
    uFields.tenths,
    uFields.numerator,
    uFields.denominator,
    rFields.score,
    rFields.tenths,
    rFields.numerator,
    rFields.denominator,
    JSON.stringify(serializeExactBreakdown(runExact)),
    new Date().toISOString(),
  );
  return buildRunScore(runId);
}

function serializeExactBreakdown(breakdown: ReturnType<typeof exactBreakdown>) {
  return Object.fromEntries(
    Object.entries(breakdown).map(([key, value]) => [
      key,
      value
        ? { numerator: value.numerator.toString(), denominator: value.denominator.toString() }
        : null,
    ]),
  );
}
export function buildRunScore(runId: string, options?: { aiOverlay?: AiOverlay }) {
  const hasAiOverlay = Boolean(options?.aiOverlay && options.aiOverlay.size > 0);
  const opportunities = loadRunOpportunities(runId, options);
  const coverageRows = getDb()
    .prepare(
      `SELECT rr.result_type,rr.rule_id,rr.tags_json,rr.node_count
       FROM rule_results rr
       WHERE rr.run_id=? ORDER BY rr.id`,
    )
    .all(runId) as Array<{
    result_type: string;
    rule_id: string;
    tags_json: string;
    node_count: number;
  }>;
  const resultTypeCounts = Object.fromEntries(
    (
      getDb()
        .prepare(
          "SELECT result_type,COUNT(*) AS count FROM rule_results WHERE run_id=? GROUP BY result_type ORDER BY result_type",
        )
        .all(runId) as Array<{ result_type: string; count: number }>
    ).map((row) => [row.result_type, Number(row.count)]),
  );
  const resultNodeCounts = { pass: 0, violation: 0, incomplete: 0, inapplicable: 0 };
  let bestPracticeIssueCount = 0;
  let aaaIssueCount = 0;
  let unmappedWcagIssueCount = 0;
  for (const row of coverageRows) {
    const count = Math.max(0, Number(row.node_count) || 0);
    if (row.result_type in resultNodeCounts)
      resultNodeCounts[row.result_type as keyof typeof resultNodeCounts] += count;
    if (row.result_type !== "violation" && row.result_type !== "incomplete") continue;
    const entry = catalogEntryWithTags(row.rule_id, JSON.parse(row.tags_json ?? "[]"));
    if (entry.level === "best-practice") bestPracticeIssueCount += count;
    if (entry.level === "AAA") aaaIssueCount += count;
    if (entry.unmappedWcag.length > 0) unmappedWcagIssueCount += count;
  }
  const exact = exactBreakdown(opportunities);
  const display = (value: typeof exact.overall) => roundHalfUpTenths(value);
  const score = {
    modelVersion: hasAiOverlay ? `${SCORE_MODEL_VERSION}+ai-overlay-v1` : SCORE_MODEL_VERSION,
    pageCount: new Set(
      (getDb().prepare("SELECT page_id FROM rule_results WHERE run_id=?").all(runId) as any[]).map(
        (r) => r.page_id,
      ),
    ).size,
    ruleCount: new Set(
      (getDb().prepare("SELECT rule_id FROM rule_results WHERE run_id=?").all(runId) as any[]).map(
        (r) => r.rule_id,
      ),
    ).size,
    opportunities: opportunities.length,
    automaticPassNodes: opportunities.filter((o) => o.passed).length,
    automaticFailNodes: opportunities.filter((o) => !o.passed).length,
    resultTypeCounts: {
      pass: Number(resultTypeCounts.pass ?? 0),
      violation: Number(resultTypeCounts.violation ?? 0),
      incomplete: Number(resultTypeCounts.incomplete ?? 0),
      inapplicable: Number(resultTypeCounts.inapplicable ?? 0),
    },
    resultNodeCounts,
    bestPracticeIssueCount,
    aaaIssueCount,
    unmappedWcagIssueCount,
    weightedDefects: opportunities.reduce(
      (sum, opportunity) => sum + (opportunity.passed ? 0 : impactWeight(opportunity.impact)),
      0,
    ),
    overall: display(exact.overall),
    perceivable: display(exact.perceivable),
    operable: display(exact.operable),
    understandable: display(exact.understandable),
    robust: display(exact.robust),
    exact,
  };
  return hasAiOverlay ? { ...score, scoreSource: "ai_overlay" as const } : score;
}

export function serializeRunScore(score: ReturnType<typeof buildRunScore>) {
  const exact = Object.fromEntries(
    Object.entries(score.exact).map(([key, value]) => [
      key,
      value
        ? { numerator: value.numerator.toString(), denominator: value.denominator.toString() }
        : null,
    ]),
  );
  return { ...score, exact };
}
