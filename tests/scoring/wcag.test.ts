import { describe, expect, it } from "vitest";
import axeCatalog from "../../configs/axe-rule-catalog.json";
import { allCatalogEntries, catalogEntry, catalogEntryWithTags } from "@/lib/wcag";
import { getRuleLocalization } from "@/lib/localization";

describe("frozen axe/WCAG catalog", () => {
  it("loads the complete generated axe catalog and freezes scoring eligibility", () => {
    expect(allCatalogEntries().map((entry) => entry.ruleId)).toEqual(
      axeCatalog.rules.map((rule) => rule.id).sort(),
    );
    expect(catalogEntry("image-alt")).toMatchObject({
      wcag: ["1.1.1"],
      principles: ["perceivable"],
      level: "A",
      scoringEligible: true,
    });
    expect(catalogEntry("accesskeys")).toMatchObject({
      level: "best-practice",
      scoringEligible: false,
      scoringReason: "best_practice",
    });
    expect(catalogEntry("color-contrast-enhanced")).toMatchObject({
      level: "AAA",
      scoringEligible: false,
      scoringReason: "wcag_aaa_only",
    });
  });

  it("preserves unknown and future tags as non-scoring evidence", () => {
    expect(catalogEntryWithTags("future-rule", ["wcag2411", "wcag499"])).toMatchObject({
      wcag: ["2.4.11"],
      principles: ["operable"],
      scoringEligible: false,
      scoringReason: "unmapped_wcag_tag",
      unmappedWcag: ["4.9.9"],
    });
  });

  it("parses WCAG criterion tags without mistaking conformance or other standards for criteria", () => {
    const cases = [
      ["wcag111", "1.1.1", "perceivable"],
      ["wcag143", "1.4.3", "perceivable"],
      ["wcag241", "2.4.1", "operable"],
      ["wcag311", "3.1.1", "understandable"],
      ["wcag412", "4.1.2", "robust"],
      ["wcag2411", "2.4.11", "operable"],
    ] as const;
    for (const [tag, criterion, principle] of cases) {
      expect(catalogEntryWithTags(`future-${tag}`, [tag])).toMatchObject({
        wcag: [criterion],
        principles: [principle],
        scoringEligible: false,
      });
    }
    expect(
      catalogEntryWithTags("future-level", ["wcag2a", "wcag2aa", "best-practice"]),
    ).toMatchObject({
      wcag: [],
      principles: [],
      level: "best-practice",
      scoringEligible: false,
    });
    expect(catalogEntryWithTags("future-other", ["section508", "EN-301-549"])).toMatchObject({
      wcag: [],
      principles: [],
      scoringEligible: false,
    });
  });

  it("exposes an explicit draft/fallback state for Chinese rule explanations", () => {
    expect(getRuleLocalization("image-alt")).toMatchObject({
      translationStatus: "ai_draft",
      fallback: false,
    });
    expect(getRuleLocalization("not-in-frozen-catalog")).toMatchObject({
      translationStatus: "ai_draft",
      fallback: true,
      zhName: "暂无人工校对中文说明",
    });
  });
});
