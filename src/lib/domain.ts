export const IMPACTS = ["minor", "moderate", "serious", "critical"] as const;
export type Impact = (typeof IMPACTS)[number];
export const RESULT_TYPES = ["violation", "incomplete", "pass", "inapplicable"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];
export const PRINCIPLES = ["perceivable", "operable", "understandable", "robust"] as const;
export type Principle = (typeof PRINCIPLES)[number];
export const JOB_STATUSES = [
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface ScanOptions {
  maxPages: number;
  sameOriginOnly: boolean;
  respectRobots: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface AxeRuleResult {
  id: string;
  impact: Impact | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{
    framePath?: string;
    frameUrl?: string;
    frameOriginRelation?: "top" | "same_origin" | "cross_origin";
    impact?: Impact | null;
    html: string;
    target: string[];
    failureSummary?: string;
    any: unknown[];
    all: unknown[];
    none: unknown[];
    aiEvidence?: {
      json: string;
      hash: string;
      version: string;
    };
  }>;
}

export interface ScanPageResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  title: string;
  discoveredAt: string;
  scannedAt: string;
  durationMs: number;
  timestamp?: string;
  testEngine?: { name: string; version: string };
  testEnvironment?: Record<string, unknown>;
  axeToolOptions?: Record<string, unknown>;
  axe: {
    passes: AxeRuleResult[];
    violations: AxeRuleResult[];
    incomplete: AxeRuleResult[];
    inapplicable: AxeRuleResult[];
  };
  frameCoverage: {
    frameTotal: number;
    sameOriginFrameTotal: number;
    crossOriginFrameTotal: number;
    frameTestedTotal: number;
    frameSkippedTotal: number;
    frameErrorCount: number;
    status: "full" | "coverage_limited" | "no_child_frames";
    issues?: string[];
  };
  sanitizedHtml?: string;
}

export interface ScoreBreakdown {
  perceivable: number;
  operable: number;
  understandable: number;
  robust: number;
  overall: number;
  totalViolations: number;
  weightedDefects: number;
  denominator: number;
  modelVersion: string;
}
