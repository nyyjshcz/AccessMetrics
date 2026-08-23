import { describe, expect, it } from "vitest";
import { deriveFormalReviewStatus } from "@/lib/formal-review-status";

const base = {
  campaignId: null,
  campaignStatus: null,
  r1ApprovalCount: 0,
  freezeStatus: null,
  sourceExportStatus: null,
  batchId: null,
  batchStatus: null,
  reviewFreezeStatus: null,
  reviewer: null,
  completedByMe: 0,
  totalForMe: 0,
} as const;

describe("formal review status", () => {
  it("does not invent a formal batch before a real campaign and R1 input", () => {
    expect(deriveFormalReviewStatus(base)).toMatchObject({
      phase: "exploratory_not_enrolled",
      externalInputRequired: true,
      reviewAvailable: false,
    });
    expect(
      deriveFormalReviewStatus({ ...base, campaignId: "campaign-1", campaignStatus: "planned" }),
    ).toMatchObject({ phase: "waiting_r1", externalInputRequired: true });
  });

  it("only exposes the current reviewer's own fixed queue", () => {
    const status = deriveFormalReviewStatus({
      ...base,
      campaignId: "campaign-1",
      campaignStatus: "r1_approved",
      r1ApprovalCount: 2,
      freezeStatus: "source_verified",
      sourceExportStatus: "verified",
      batchId: "batch-1",
      batchStatus: "open",
      reviewer: "computer_lead",
      completedByMe: 3,
      totalForMe: 40,
    });
    expect(status).toMatchObject({
      phase: "review_ready",
      reviewAvailable: true,
      myProgress: { completed: 3, total: 40, remaining: 37 },
    });
    expect(JSON.stringify(status)).not.toContain("other");
    expect(JSON.stringify(status)).not.toContain("agreement");
  });

  it("keeps a finished reviewer blind while the formal chain is still pending", () => {
    expect(
      deriveFormalReviewStatus({
        ...base,
        campaignId: "campaign-1",
        campaignStatus: "r1_approved",
        r1ApprovalCount: 2,
        freezeStatus: "source_verified",
        sourceExportStatus: "verified",
        batchId: "batch-1",
        batchStatus: "open",
        reviewer: "math_lead",
        completedByMe: 40,
        totalForMe: 40,
      }),
    ).toMatchObject({ phase: "my_review_complete", reviewAvailable: true });
  });
});
