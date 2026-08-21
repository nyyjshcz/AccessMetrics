import type { Impact, Principle, ScoreBreakdown } from "./domain";

export const SCORE_MODEL_VERSION = "accesscheck-score-v1";
export const DEFAULT_WEIGHTS: Record<Impact, number> = {
  critical: 40,
  serious: 30,
  moderate: 20,
  minor: 10,
};

export interface ScoreOpportunity {
  principle?: Principle;
  /**
   * A single axe node can map to more than one WCAG principle.  Keep the
   * opportunity as one item for the overall score and use this list only when
   * calculating a principle-specific view.  `principle` remains supported for
   * the small public/fixture API used by older callers.
   */
  principles?: readonly Principle[];
  passed: boolean;
  impact?: Impact | null;
}

function belongsToPrinciple(item: ScoreOpportunity, principle: Principle) {
  return item.principles ? item.principles.includes(principle) : item.principle === principle;
}

export interface ExactScore {
  numerator: bigint;
  denominator: bigint;
}

export function exactScore(
  opportunities: ScoreOpportunity[],
  weights: Readonly<Record<Impact, number>> = DEFAULT_WEIGHTS,
  maxWeight = 40,
): ExactScore | null {
  const judged = opportunities.filter((item) => item.passed || Boolean(item.impact));
  if (judged.length === 0) return null;
  const failed = judged.reduce(
    (sum, item) => sum + (item.passed ? 0 : (weights[item.impact ?? "minor"] ?? 10)),
    0,
  );
  const denominator = BigInt(maxWeight * judged.length);
  const numerator = BigInt(100 * (maxWeight * judged.length - failed));
  if (numerator < 0n || numerator > 100n * denominator) throw new Error("score bounds violated");
  return { numerator, denominator };
}

export function roundHalfUpTenths(score: ExactScore | null): number | null {
  if (!score) return null;
  const tenths = (2n * score.numerator * 10n + score.denominator) / (2n * score.denominator);
  return Number(tenths) / 10;
}

export function scoreOpportunities(opportunities: ScoreOpportunity[]): ScoreBreakdown {
  const all = exactScore(opportunities);
  const byPrinciple = (principle: Principle) =>
    exactScore(opportunities.filter((item) => belongsToPrinciple(item, principle)));
  const score = (value: ExactScore | null) => roundHalfUpTenths(value) ?? 0;
  const judged = opportunities.filter((item) => item.passed || Boolean(item.impact));
  return {
    perceivable: score(byPrinciple("perceivable")),
    operable: score(byPrinciple("operable")),
    understandable: score(byPrinciple("understandable")),
    robust: score(byPrinciple("robust")),
    overall: score(all),
    totalViolations: judged.filter((item) => !item.passed).length,
    weightedDefects: judged.reduce(
      (sum, item) => sum + (item.passed ? 0 : DEFAULT_WEIGHTS[item.impact ?? "minor"]),
      0,
    ),
    denominator: judged.length * 40,
    modelVersion: SCORE_MODEL_VERSION,
  };
}

export function compareExact(a: ExactScore, b: ExactScore): number {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  return left === right ? 0 : left > right ? 1 : -1;
}

export function exactBreakdown(opportunities: ScoreOpportunity[]) {
  const all = exactScore(opportunities);
  const byPrinciple = (principle: Principle) =>
    exactScore(opportunities.filter((item) => belongsToPrinciple(item, principle)));
  return {
    overall: all,
    perceivable: byPrinciple("perceivable"),
    operable: byPrinciple("operable"),
    understandable: byPrinciple("understandable"),
    robust: byPrinciple("robust"),
  };
}
