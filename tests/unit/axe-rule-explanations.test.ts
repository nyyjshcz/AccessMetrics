import { describe, expect, it } from "vitest";
import axeCatalog from "../../configs/axe-rule-catalog.json";
import {
  AXE_RULE_EXPLANATIONS,
  AXE_RULE_EXPLANATION_COUNT,
  axeRuleSourceHash,
  getAxeRuleExplanation,
} from "@/lib/axe-rule-explanations";

describe("static axe rule explanations", () => {
  it("covers every current axe rule", () => {
    expect(axeCatalog.rules).toHaveLength(105);
    expect(AXE_RULE_EXPLANATION_COUNT).toBe(105);
    expect(Object.keys(AXE_RULE_EXPLANATIONS).sort()).toEqual(
      axeCatalog.rules.map((rule) => rule.id).sort(),
    );
    for (const rule of axeCatalog.rules) {
      const copy = AXE_RULE_EXPLANATIONS[rule.id].zh;
      expect(copy.name).not.toBe(`规则：${rule.id}`);
      expect(copy.name.length).toBeGreaterThan(2);
      expect(copy.what).not.toContain(rule.help);
      expect(copy.who.length).toBeGreaterThan(2);
      expect(copy.why.length).toBeGreaterThan(2);
    }
  });

  it("returns bilingual copy for a matching source", () => {
    const rule = axeCatalog.rules.find((item) => item.id === "image-alt")!;
    const result = getAxeRuleExplanation("image-alt", rule);
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.explanation.zh.name).toBe("图像替代文本");
      expect(result.explanation.en.what).toContain("alternative text");
      expect(result.explanation.sourceHash).toBe(axeRuleSourceHash(rule));
    }
    expect(
      getAxeRuleExplanation("image-alt", {
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
    const rule = axeCatalog.rules.find((item) => item.id === "image-alt")!;
    const changed = getAxeRuleExplanation("image-alt", { ...rule, help: "changed source" });
    expect(changed.matched).toBe(false);
    if (!changed.matched) expect(changed.fallback.name).toBe("changed source");
    const unknown = getAxeRuleExplanation("new-rule", {
      description: "Original description",
      help: "Original help",
      helpUrl: "https://example.test/rule",
      tags: [],
    });
    expect(unknown.matched).toBe(false);
    if (!unknown.matched) {
      expect(unknown.fallback.what).toBe("Original description");
      expect(unknown.fallback.who).toBe("");
      expect(unknown.fallback.why).toBe("");
    }
  });
});
