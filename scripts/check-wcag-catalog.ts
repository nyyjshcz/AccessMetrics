import fs from "node:fs";
import path from "node:path";

if (process.argv.includes("--help")) {
  console.log("usage: pnpm catalog:check");
  process.exit(0);
}
const root = process.cwd();
const wcag = JSON.parse(
  fs.readFileSync(path.join(root, "scoring", "wcag-criteria.v2.2.json"), "utf8"),
);
const golden = JSON.parse(
  fs.readFileSync(path.join(root, "tests", "golden", "wcag-criteria-v2.2.expected.json"), "utf8"),
);
const actual = wcag.criteria.map((item: { id: string }) => item.id);
if (JSON.stringify(actual) !== JSON.stringify(golden.criteria))
  throw new Error("WCAG catalog and independent golden snapshot differ");
if (
  new Set(actual).size !== actual.length ||
  actual.includes("4.1.1") ||
  !golden.removedFromScoring.includes("4.1.1")
)
  throw new Error("WCAG catalog uniqueness/removed criteria check failed");
const axe = JSON.parse(
  fs.readFileSync(path.join(root, "configs", "axe-rule-catalog.json"), "utf8"),
);
if (axe.axeVersion !== "4.13.0" || !Array.isArray(axe.rules) || axe.rules.length === 0)
  throw new Error("axe catalog is not generated");
const criteria = wcag.criteria as Array<{ id: string; level: string }>;
const criteriaById = new Map(criteria.map((item) => [item.id, item]));
for (const rule of axe.rules) {
  if (
    !Array.isArray(rule.tags) ||
    !Array.isArray(rule.wcag) ||
    !Array.isArray(rule.principles) ||
    !Array.isArray(rule.unmappedWcag) ||
    typeof rule.scoringEligible !== "boolean" ||
    typeof rule.scoringReason !== "string" ||
    !["A", "AA", "AAA", "best-practice", "unknown"].includes(rule.level)
  )
    throw new Error(`axe rule catalog enrichment missing: ${rule.id}`);
  if (rule.wcag.some((id: string) => !criteriaById.has(id)))
    throw new Error(`axe rule catalog contains unknown WCAG id: ${rule.id}`);
  const eligibleByCriteria = rule.wcag.some((id: string) =>
    ["A", "AA"].includes(criteriaById.get(id)?.level ?? ""),
  );
  if (rule.scoringEligible !== eligibleByCriteria)
    throw new Error(`axe rule scoring eligibility mismatch: ${rule.id}`);
}
console.log(
  JSON.stringify({ passed: true, wcagCriteria: actual.length, axeRules: axe.rules.length }),
);
