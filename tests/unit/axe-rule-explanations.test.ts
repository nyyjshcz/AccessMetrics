import { describe, expect, it } from "vitest";
import axeCatalog from "../../configs/axe-rule-catalog.json";
import { RULE_COPY_A } from "@/lib/axe-rule-copy/a";
import { RULE_COPY_B } from "@/lib/axe-rule-copy/b";
import { RULE_COPY_C } from "@/lib/axe-rule-copy/c";
import {
  AXE_RULE_EXPLANATIONS,
  AXE_RULE_EXPLANATION_COUNT,
  axeRuleSourceHash,
  getAxeRuleExplanation,
} from "@/lib/axe-rule-explanations";

const catalogRuleIds = axeCatalog.rules.map((rule) => rule.id).sort();
const staticCopyShards = [RULE_COPY_A, RULE_COPY_B, RULE_COPY_C];
const staticCopyIds = staticCopyShards.flatMap((shard) => Object.keys(shard));
const uniqueStaticCopyIds = [...new Set(staticCopyIds)].sort();

describe("static axe rule explanations", () => {
  it("covers every current axe rule", () => {
    expect(AXE_RULE_EXPLANATION_COUNT).toBe(axeCatalog.rules.length);
    expect(Object.keys(AXE_RULE_EXPLANATIONS).sort()).toEqual(catalogRuleIds);
    expect(staticCopyIds.length).toBe(uniqueStaticCopyIds.length);
    expect(uniqueStaticCopyIds).toEqual(catalogRuleIds);
    for (const rule of axeCatalog.rules) {
      const explanation = AXE_RULE_EXPLANATIONS[rule.id];
      expect(explanation.ruleId).toBe(rule.id);
      expect(explanation.sourceDescription).toBe(rule.description);
      expect(explanation.sourceHelp).toBe(rule.help);
      expect(explanation.sourceHelpUrl).toBe(rule.helpUrl);
      expect(explanation.sourceHash).toBe(axeRuleSourceHash(rule));
      for (const copy of [explanation.en, explanation.zh]) {
        for (const field of [copy.name, copy.what, copy.who, copy.why]) {
          expect(field.trim()).not.toBe("");
        }
      }
    }
  });

  it("returns bilingual copy for a matching source", () => {
    const rule = axeCatalog.rules[0];
    const result = getAxeRuleExplanation(rule.id, rule);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.explanation).toBe(AXE_RULE_EXPLANATIONS[rule.id]);
      expect(result.explanation.sourceHash).toBe(axeRuleSourceHash(rule));
    }
    expect(
      getAxeRuleExplanation(rule.id, {
        description: rule.description,
        help: rule.help,
        helpUrl: rule.helpUrl,
      }).matched,
    ).toBe(true);
    expect(axeRuleSourceHash({ ...rule, tags: ["changed-metadata"] })).toBe(
      axeRuleSourceHash(rule),
    );
  });

  it("falls back to axe original text for unknown or changed rules", () => {
    const rule = axeCatalog.rules[0];
    const changed = getAxeRuleExplanation(rule.id, { ...rule, help: "changed source" });
    expect(changed.matched).toBe(false);
    if (!changed.matched) {
      expect(changed.fallback).toEqual({
        name: "changed source",
        what: rule.description,
        who: "",
        why: "",
      });
    }
    const unknown = getAxeRuleExplanation("new-rule", {
      description: "Original description",
      help: "Original help",
      helpUrl: "https://example.test/rule",
    });
    expect(unknown.matched).toBe(false);
    if (!unknown.matched) {
      expect(unknown.fallback.what).toBe("Original description");
      expect(unknown.fallback.who).toBe("");
      expect(unknown.fallback.why).toBe("");
    }
  });
});
