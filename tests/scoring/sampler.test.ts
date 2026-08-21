import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sampleManualReview, selectWithinQuota } from "@/lib/sampler";
describe("manual-review-sampler-v1", () => {
  it("is deterministic, capped at 40, and allocates every selected ID once", () => {
    const items = Array.from({ length: 60 }, (_, index) => ({
      resultNodeId: `n${index}`,
      resultType: index % 5 === 0 ? ("incomplete" as const) : ("violation" as const),
      impact:
        index % 4 === 0
          ? "critical"
          : index % 4 === 1
            ? "serious"
            : index % 4 === 2
              ? "moderate"
              : "minor",
      ruleId: `rule-${index % 3}`,
    }));
    const a = sampleManualReview(items, "population");
    const b = sampleManualReview(items, "population");
    expect(a).toEqual(b);
    expect(a.selected).toHaveLength(40);
    expect(new Set(a.selected.map((item) => item.resultNodeId)).size).toBe(40);
    expect(Object.values(a.quota).reduce((x, y) => x + y, 0)).toBe(40);
  });

  it("matches the fixed round-robin golden vector", () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "tests", "golden", "manual-review-sampler-v1-small.json"),
        "utf8",
      ),
    );
    const items = Object.entries(fixture.groups).flatMap(([ruleId, ids]) =>
      (ids as string[]).map((resultNodeId) => ({
        resultNodeId,
        resultType: "violation" as const,
        impact: "serious",
        ruleId,
      })),
    );
    expect(
      selectWithinQuota(items, fixture.seed, fixture.stratum, fixture.quota).map(
        (item) => item.resultNodeId,
      ),
    ).toEqual(fixture.expectedSelectedIds);
  });

  it("matches the complete fixed 60-node fixture", () => {
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "tests", "golden", "manual-review-sampler-v1-full.json"),
        "utf8",
      ),
    );
    const items = Array.from({ length: fixture.populationSize }, (_, index) => ({
      resultNodeId: `n${index}`,
      resultType: index % 5 === 0 ? ("incomplete" as const) : ("violation" as const),
      impact:
        index % 4 === 0
          ? "critical"
          : index % 4 === 1
            ? "serious"
            : index % 4 === 2
              ? "moderate"
              : "minor",
      ruleId: `rule-${index % 3}`,
    }));
    const result = sampleManualReview(items, fixture.populationDigest);
    expect(result.seed).toBe("33f65bcb45212d3d");
    expect(result.quota).toEqual(fixture.quota);
    expect(result.selected.map((item) => item.resultNodeId)).toEqual(fixture.expectedSelectedIds);
  });
});
