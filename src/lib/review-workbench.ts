import { sha256 } from "./canonical";

export const EXPLORATORY_REVIEW_LIMIT = 12;

export type ReviewVerdict = "confirmed" | "not_an_issue" | "uncertain";

export type CurrentNodeReview = {
  id: string;
  verdict: ReviewVerdict;
  note: string;
  revision: number;
  reviewedAt: string;
};

export type ReviewWorkbenchInput = {
  findingId: string;
  resultNodeId: string;
  resultType: "incomplete";
  impact: string | null;
  ruleId: string;
  description: string;
  help: string;
  helpUrl: string;
  pageId: string;
  pageUrl: string;
  pageTitle: string | null;
  ordinal: number;
  target: unknown;
  html: string;
  failureSummary: string | null;
  framePath: unknown;
  frameUrl: string | null;
  frameOriginRelation: string | null;
  targetHash: string | null;
  effectiveImpact: string | null;
  currentReview: CurrentNodeReview | null;
  anyReviewerCount: number;
};

export type ReviewWorkbenchFinding = {
  id: string;
  resultType: "incomplete";
  impact: string | null;
  ruleId: string;
  description: string;
  help: string;
  helpUrl: string;
  pageId: string;
  pageUrl: string;
  pageTitle: string | null;
  nodeCount: number;
  reviewedNodeCount: number;
  currentReviewerReviewedNodeCount: number;
  representativeNodes: ReviewWorkbenchInput[];
  priority: boolean;
};

const impactRank: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

function findingOrder(left: ReviewWorkbenchFinding, right: ReviewWorkbenchFinding) {
  return (
    (impactRank[left.impact ?? ""] ?? 4) - (impactRank[right.impact ?? ""] ?? 4) ||
    right.nodeCount - left.nodeCount ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.pageUrl.localeCompare(right.pageUrl) ||
    left.id.localeCompare(right.id)
  );
}

function selectPriorityFindings(findings: ReviewWorkbenchFinding[]) {
  const selected = new Set<string>();
  for (const item of [...findings].sort(findingOrder)) {
    if (selected.size >= EXPLORATORY_REVIEW_LIMIT) break;
    selected.add(item.id);
  }
  return selected;
}

/**
 * Builds the everyday review view from immutable scan evidence. It deliberately
 * selects individual representative nodes; a human conclusion never marks the
 * rest of a finding group as reviewed or changes the automatic score.
 */
export function buildReviewWorkbench(items: ReviewWorkbenchInput[]) {
  const grouped = new Map<string, ReviewWorkbenchInput[]>();
  for (const item of items) {
    const list = grouped.get(item.findingId) ?? [];
    list.push(item);
    grouped.set(item.findingId, list);
  }
  const findings = [...grouped.entries()]
    .map(([id, group]) => {
      const first = group[0]!;
      const representativeNodes = [...group]
        .sort(
          (left, right) =>
            sha256(`${id}|${left.resultNodeId}`).localeCompare(
              sha256(`${id}|${right.resultNodeId}`),
            ) || left.resultNodeId.localeCompare(right.resultNodeId),
        )
        .slice(0, 3);
      return {
        id,
        resultType: first.resultType,
        impact: first.impact,
        ruleId: first.ruleId,
        description: first.description,
        help: first.help,
        helpUrl: first.helpUrl,
        pageId: first.pageId,
        pageUrl: first.pageUrl,
        pageTitle: first.pageTitle,
        nodeCount: group.length,
        reviewedNodeCount: group.filter((item) => item.anyReviewerCount > 0).length,
        currentReviewerReviewedNodeCount: group.filter((item) => item.currentReview).length,
        representativeNodes,
        priority: false,
      } satisfies ReviewWorkbenchFinding;
    })
    .sort(findingOrder);
  // Everyday review is deliberately a first-pass queue, not a 600-node
  // checklist. Once this reviewer has left a note on any node in a finding
  // group, the group yields its place to the next unvisited group. The full
  // evidence catalogue remains available for deeper follow-up.
  const outstandingFindings = findings.filter(
    (finding) => finding.currentReviewerReviewedNodeCount === 0,
  );
  const priorityIds = selectPriorityFindings(outstandingFindings);
  const withPriority = findings.map((finding) => ({
    ...finding,
    priority: priorityIds.has(finding.id),
  }));
  const prioritySamples = withPriority
    .filter((finding) => finding.priority)
    .map((finding) => ({ ...finding, node: finding.representativeNodes[0]! }));
  const contextFindings = withPriority.filter((finding) => finding.resultType === "incomplete");
  const contextNodeCount = contextFindings.reduce((total, finding) => total + finding.nodeCount, 0);
  const automaticNodeCount = withPriority.reduce((total, finding) => total + finding.nodeCount, 0);
  const dailyReviewedFindingCount = withPriority.length - outstandingFindings.length;
  const dailyReviewedNodeCount = withPriority.reduce(
    (total, finding) => total + finding.currentReviewerReviewedNodeCount,
    0,
  );
  return {
    summary: {
      automaticNodeCount,
      findingCount: withPriority.length,
      contextNodeCount,
      contextFindingCount: contextFindings.length,
      prioritySampleCount: prioritySamples.length,
      dailyReviewedFindingCount,
      dailyRemainingFindingCount: outstandingFindings.length,
      dailyReviewedNodeCount,
      formalReview: { maxSamplesPerReviewer: 40, reviewerCount: 2 },
    },
    findings: withPriority,
    prioritySamples,
  };
}
