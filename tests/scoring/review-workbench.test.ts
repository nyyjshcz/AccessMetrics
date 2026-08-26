import { describe, expect, it } from "vitest";
import { buildReviewWorkbench, type ReviewWorkbenchInput } from "@/lib/review-workbench";

function node(
  findingId: string,
  resultNodeId: string,
  resultType: "incomplete",
  impact: string | null,
  overrides: Partial<ReviewWorkbenchInput> = {},
): ReviewWorkbenchInput {
  return {
    findingId,
    resultNodeId,
    resultType,
    impact,
    ruleId: `rule-${findingId}`,
    description: "Automatic rule description",
    help: "Automatic rule help",
    helpUrl: "https://example.test/help",
    pageId: `page-${findingId}`,
    pageUrl: `https://example.test/${findingId}`,
    pageTitle: findingId,
    ordinal: 0,
    target: ["main"],
    html: "<main></main>",
    failureSummary: null,
    framePath: [],
    frameUrl: null,
    frameOriginRelation: "top",
    targetHash: null,
    effectiveImpact: impact,
    currentReview: null,
    anyReviewerCount: 0,
    ...overrides,
  };
}

describe("exploratory review workbench", () => {
  it("groups all evidence, samples a small deterministic queue, and never expands one verdict to a group", () => {
    const inputs: ReviewWorkbenchInput[] = [
      node("context-large", "context-large-1", "incomplete", null, {
        currentReview: {
          id: "review-1",
          verdict: "confirmed",
          note: "The control needs a real-label check.",
          revision: 1,
          reviewedAt: "2026-08-24T00:00:00.000Z",
        },
        anyReviewerCount: 1,
      }),
      node("context-large", "context-large-2", "incomplete", null),
      node("context-large", "context-large-3", "incomplete", null),
      ...Array.from({ length: 8 }, (_, index) =>
        node(`context-${index}`, `context-${index}-node`, "incomplete", null),
      ),
    ];

    const first = buildReviewWorkbench(inputs);
    const second = buildReviewWorkbench(inputs);

    expect(first).toEqual(second);
    expect(first.summary).toMatchObject({
      automaticNodeCount: 11,
      findingCount: 9,
      contextNodeCount: 11,
      contextFindingCount: 9,
      prioritySampleCount: 8,
      dailyReviewedFindingCount: 1,
      dailyRemainingFindingCount: 8,
      dailyReviewedNodeCount: 1,
    });
    expect(new Set(first.prioritySamples.map((sample) => sample.id)).size).toBe(8);
    expect(first.prioritySamples).toHaveLength(8);

    const largeGroup = first.findings.find((finding) => finding.id === "context-large");
    expect(largeGroup).toMatchObject({
      nodeCount: 3,
      reviewedNodeCount: 1,
      currentReviewerReviewedNodeCount: 1,
    });
    expect(first.prioritySamples.filter((sample) => sample.id === "context-large")).toHaveLength(0);
  });
});
