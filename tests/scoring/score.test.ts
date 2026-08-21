import { describe, expect, it } from "vitest";
import { exactScore, roundHalfUpTenths, scoreOpportunities } from "@/lib/score";

describe("accesscheck-score-v1", () => {
  it("uses pass/fail opportunities and exact half-up display", () => {
    const exact = exactScore([
      ...Array.from({ length: 8 }, () => ({ passed: true, principle: "perceivable" as const })),
      ...Array.from({ length: 2 }, () => ({
        passed: false,
        impact: "critical" as const,
        principle: "perceivable" as const,
      })),
      ...Array.from({ length: 27 }, () => ({ passed: true, principle: "perceivable" as const })),
      ...Array.from({ length: 3 }, () => ({
        passed: false,
        impact: "serious" as const,
        principle: "perceivable" as const,
      })),
    ]);
    expect(exact).toEqual({ numerator: 143000n, denominator: 1600n });
    expect(roundHalfUpTenths(exact)).toBe(89.4);
  });

  it("returns null for no computable opportunities", () => {
    expect(exactScore([])).toBeNull();
    expect(scoreOpportunities([]).overall).toBe(0);
  });
  it("returns 100 when every computable opportunity passes", () => {
    const exact = exactScore([
      { passed: true, principle: "perceivable" },
      { passed: true, principle: "operable" },
      { passed: true, principle: "understandable" },
      { passed: true, principle: "robust" },
    ]);
    expect(roundHalfUpTenths(exact)).toBe(100);
  });
  it("returns zero when every computable opportunity is critical", () => {
    const exact = exactScore([
      { passed: false, impact: "critical", principle: "perceivable" },
      { passed: false, impact: "critical", principle: "operable" },
    ]);
    expect(roundHalfUpTenths(exact)).toBe(0);
  });
  it("does not penalize incomplete or null-impact results", () => {
    expect(exactScore([{ passed: false, impact: null, principle: "perceivable" }])).toBeNull();
  });
  it("keeps principle scores independent while preserving overall count", () => {
    const score = scoreOpportunities([
      { passed: false, impact: "serious", principle: "perceivable" },
      { passed: false, impact: "serious", principle: "operable" },
    ]);
    expect(score.perceivable).toBe(25);
    expect(score.operable).toBe(25);
    expect(score.overall).toBe(25);
  });

  it("counts a multi-principle rule once overall and in each applicable principle", () => {
    const score = scoreOpportunities([
      { passed: true, principles: ["perceivable", "operable"] },
      { passed: false, impact: "serious", principles: ["perceivable", "operable"] },
    ]);
    expect(score.overall).toBe(62.5);
    expect(score.perceivable).toBe(62.5);
    expect(score.operable).toBe(62.5);
    expect(score.understandable).toBe(0);
    expect(score.robust).toBe(0);
  });
});
