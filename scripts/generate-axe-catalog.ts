import fs from "node:fs";
import path from "node:path";
import { getRules } from "axe-core";
import criteriaCatalog from "../scoring/wcag-criteria.v2.2.json";

type Principle = "perceivable" | "operable" | "understandable" | "robust";
type Level = "A" | "AA" | "AAA" | "best-practice" | "unknown";

const criteriaById = new Map(
  criteriaCatalog.criteria.map((criterion) => [criterion.id, criterion]),
);
const tagPattern = /^wcag([1-4])([1-9])([0-9]{1,2})$/i;

function enrichRule(rule: ReturnType<typeof getRules>[number]) {
  const tags = [...rule.tags].sort();
  const parsedTags = tags
    .map((tag) => ({ tag, match: tagPattern.exec(tag) }))
    .filter((item): item is { tag: string; match: RegExpExecArray } => Boolean(item.match));
  const numericTags = parsedTags.map(
    (item) => `${item.match[1]}.${item.match[2]}.${item.match[3]}`,
  );
  const wcag = [...new Set(numericTags.filter((id) => criteriaById.has(id)))].sort();
  const criteria = wcag.map((id) => criteriaById.get(id)!);
  const principles = [...new Set(criteria.map((criterion) => criterion.principle))] as Principle[];
  const levels = new Set(criteria.map((criterion) => criterion.level));
  const level: Level = criteria.length
    ? levels.has("A")
      ? "A"
      : levels.has("AA")
        ? "AA"
        : "AAA"
    : tags.includes("best-practice")
      ? "best-practice"
      : tags.includes("wcag2aaa")
        ? "AAA"
        : "unknown";
  const scoringEligible = criteria.some(
    (criterion) => criterion.level === "A" || criterion.level === "AA",
  );
  const unmappedWcag = [...new Set(numericTags.filter((id) => !criteriaById.has(id)))].sort();
  const scoringReason = scoringEligible
    ? "wcag_a_or_aa"
    : level === "best-practice"
      ? "best_practice"
      : level === "AAA"
        ? "wcag_aaa_only"
        : unmappedWcag.length
          ? "unmapped_wcag_tag"
          : "no_wcag_success_criterion";
  return {
    id: rule.ruleId,
    impact: (rule as { impact?: string | null }).impact ?? null,
    description: rule.description,
    help: rule.help,
    tags,
    helpUrl: rule.helpUrl,
    wcag,
    principles,
    level,
    scoringEligible,
    scoringReason,
    unmappedWcag,
  };
}

const rules = getRules()
  .map(enrichRule)
  .sort((a, b) => a.id.localeCompare(b.id));
const payload =
  JSON.stringify({ schemaVersion: "axe-rule-catalog-v1", axeVersion: "4.13.0", rules }, null, 2) +
  "\n";
for (const relative of ["configs/axe-rule-catalog.json", "scoring/axe-rule-catalog.json"]) {
  const output = path.join(process.cwd(), relative);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, payload);
}
console.log(`generated ${rules.length} enriched axe rules`);
