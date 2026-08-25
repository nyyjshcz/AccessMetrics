import {
  DEFAULT_WEIGHTS,
  exactScore,
  MAX_WEIGHT,
  roundHalfUpTenths,
  type ScoreOpportunity,
} from "./score";
import { compareExact } from "./score";
export const SENSITIVITY_SCENARIOS = {
  A: DEFAULT_WEIGHTS,
  B: { critical: 50, serious: 30, moderate: 20, minor: 10 },
  C: { critical: 40, serious: 25, moderate: 15, minor: 10 },
} as const;
export function sensitivityAnalysis(sites: Record<string, ScoreOpportunity[]>) {
  const outputs = Object.entries(SENSITIVITY_SCENARIOS).map(([name, weights]) => {
    const exact: Record<string, NonNullable<ReturnType<typeof exactScore>>> = {};
    for (const [site, opportunities] of Object.entries(sites)) {
      const value = exactScore(opportunities, weights, name === "B" ? 50 : MAX_WEIGHT);
      if (value) exact[site] = value;
    }
    const ranking = Object.keys(exact).sort(
      (a, b) => compareExact(exact[b], exact[a]) || a.localeCompare(b),
    );
    return {
      scenario: name,
      scores: Object.fromEntries(
        Object.entries(exact).map(([site, value]) => [
          site,
          {
            exactNumerator: value.numerator.toString(),
            exactDenominator: value.denominator.toString(),
            display: roundHalfUpTenths(value),
          },
        ]),
      ),
      ranking,
    };
  });
  return outputs;
}
