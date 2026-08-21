import type { Impact, Principle } from "./domain";
import axeCatalog from "../../configs/axe-rule-catalog.json";
import criteriaCatalog from "../../scoring/wcag-criteria.v2.2.json";

export interface RuleCatalogEntry {
  ruleId: string;
  principles: Principle[];
  wcag: string[];
  level: "A" | "AA" | "AAA" | "best-practice" | "unknown";
  scoringEligible: boolean;
  scoringReason: string;
  unmappedWcag: string[];
}

type GeneratedRule = {
  id: string;
  tags: string[];
  wcag?: string[];
  principles?: Principle[];
  level?: RuleCatalogEntry["level"];
  scoringEligible?: boolean;
  scoringReason?: string;
  unmappedWcag?: string[];
};

const generatedRules = new Map(
  (axeCatalog.rules as GeneratedRule[]).map((rule) => [rule.id, rule]),
);
const criteriaById = new Map(
  criteriaCatalog.criteria.map((criterion) => [criterion.id, criterion]),
);
const tagPattern = /^wcag([1-4])([1-9])([0-9]{1,2})$/i;
const fallback = (ruleId: string): RuleCatalogEntry => ({
  ruleId,
  principles: [],
  wcag: [],
  level: "unknown",
  scoringEligible: false,
  scoringReason: "unknown_rule",
  unmappedWcag: [],
});

function fromTags(ruleId: string, tags: string[]): RuleCatalogEntry {
  const numericTags = tags
    .map((tag) => tagPattern.exec(tag))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => `${match[1]}.${match[2]}.${match[3]}`);
  const wcag = [...new Set(numericTags.filter((id) => criteriaById.has(id)))].sort();
  const criteria = wcag.map((id) => criteriaById.get(id)!);
  const principles = [...new Set(criteria.map((criterion) => criterion.principle))] as Principle[];
  const scoringEligible = criteria.some(
    (criterion) => criterion.level === "A" || criterion.level === "AA",
  );
  const unmappedWcag = [...new Set(numericTags.filter((id) => !criteriaById.has(id)))].sort();
  const level: RuleCatalogEntry["level"] = criteria.length
    ? criteria.some((criterion) => criterion.level === "A")
      ? "A"
      : criteria.some((criterion) => criterion.level === "AA")
        ? "AA"
        : "AAA"
    : tags.includes("best-practice")
      ? "best-practice"
      : tags.includes("wcag2aaa")
        ? "AAA"
        : "unknown";
  return {
    ruleId,
    principles,
    wcag,
    level,
    scoringEligible,
    scoringReason: scoringEligible
      ? "wcag_a_or_aa"
      : level === "best-practice"
        ? "best_practice"
        : level === "AAA"
          ? "wcag_aaa_only"
          : unmappedWcag.length
            ? "unmapped_wcag_tag"
            : "no_wcag_success_criterion",
    unmappedWcag,
  };
}

export const RULE_CATALOG_VERSION = "wcag-2.2-axe-4.13.0-v1";

export function catalogEntry(ruleId: string): RuleCatalogEntry {
  const rule = generatedRules.get(ruleId);
  if (!rule) return fallback(ruleId);
  if (
    rule.wcag &&
    rule.principles &&
    rule.level &&
    typeof rule.scoringEligible === "boolean" &&
    rule.scoringReason &&
    rule.unmappedWcag
  )
    return {
      ruleId,
      principles: [...rule.principles],
      wcag: [...rule.wcag],
      level: rule.level,
      scoringEligible: rule.scoringEligible,
      scoringReason: rule.scoringReason,
      unmappedWcag: [...rule.unmappedWcag],
    };
  return fromTags(ruleId, rule.tags);
}

export function catalogEntryWithTags(ruleId: string, tags: string[]): RuleCatalogEntry {
  // Scan-time tags remain raw evidence; eligibility comes from the frozen catalog.
  if (generatedRules.has(ruleId)) return catalogEntry(ruleId);
  const parsed = fromTags(ruleId, tags);
  return {
    ...parsed,
    scoringEligible: false,
    scoringReason: parsed.unmappedWcag.length ? "unmapped_wcag_tag" : "unknown_rule",
  };
}

export function classifyImpact(impact: string | null | undefined): Impact | null {
  return impact === "critical" ||
    impact === "serious" ||
    impact === "moderate" ||
    impact === "minor"
    ? impact
    : null;
}

export function allCatalogEntries() {
  return [...generatedRules.keys()].sort().map((ruleId) => {
    const entry = catalogEntry(ruleId);
    return {
      ...entry,
      principles: [...entry.principles],
      wcag: [...entry.wcag],
      unmappedWcag: [...entry.unmappedWcag],
    };
  });
}
