import axeCatalog from "../../configs/axe-rule-catalog.json";
import { canonicalize, sha256 } from "./canonical";
import { RULE_COPY_A } from "./axe-rule-copy/a";
import { RULE_COPY_B } from "./axe-rule-copy/b";
import { RULE_COPY_C } from "./axe-rule-copy/c";
import type { AxeRuleCopyText, StaticAxeRuleCopy } from "./axe-rule-copy/types";

export type RuleExplanation = {
  ruleId: string;
  sourceDescription: string;
  sourceHelp: string;
  sourceHelpUrl: string;
  sourceVersion: string;
  sourceHash: string;
  en: AxeRuleCopyText;
  zh: AxeRuleCopyText;
};

type RawRule = (typeof axeCatalog.rules)[number];
export type AxeRuleSource = Pick<RawRule, "description" | "help" | "helpUrl"> & {
  tags?: string[];
};

/**
 * The source identity intentionally contains only axe's human-readable
 * description and help text. Tags and other catalog metadata can differ in a
 * stored result without changing the meaning of the rule copy.
 */
export function axeRuleSourceHash(
  rule: Pick<RawRule, "description" | "help"> & Partial<RawRule>,
): string {
  return sha256(
    canonicalize({
      sourceDescription: rule.description,
      sourceHelp: rule.help,
    }),
  );
}

const STATIC_COPIES: Record<string, StaticAxeRuleCopy> = {
  ...RULE_COPY_A,
  ...RULE_COPY_B,
  ...RULE_COPY_C,
};

const catalog = Object.fromEntries(
  (axeCatalog.rules as RawRule[]).map((rule) => {
    const copy = STATIC_COPIES[rule.id];
    if (!copy) {
      throw new Error(`Missing static axe rule copy for ${rule.id}`);
    }
    return [
      rule.id,
      {
        ruleId: rule.id,
        sourceDescription: rule.description,
        sourceHelp: rule.help,
        sourceHelpUrl: rule.helpUrl,
        sourceVersion: `axe-core-${axeCatalog.axeVersion}`,
        sourceHash: axeRuleSourceHash(rule),
        en: copy.en,
        zh: copy.zh,
      } satisfies RuleExplanation,
    ];
  }),
) as Record<string, RuleExplanation>;

export const AXE_RULE_EXPLANATIONS = catalog;
export const AXE_RULE_EXPLANATION_COUNT = Object.keys(catalog).length;

export type RuleExplanationResult =
  | { matched: true; explanation: RuleExplanation }
  | {
      matched: false;
      ruleId: string;
      fallback: {
        name: string;
        what: string;
        who: string;
        why: string;
      };
    };

/** Resolve reviewed copy only when both stored axe source strings match. */
export function getAxeRuleExplanation(
  ruleId: string,
  source: AxeRuleSource,
): RuleExplanationResult {
  const entry = catalog[ruleId];
  if (
    entry &&
    entry.sourceHash ===
      axeRuleSourceHash({
        description: source.description,
        help: source.help,
      })
  ) {
    return { matched: true, explanation: entry };
  }

  // A missing rule or a source mismatch must remain transparent: show the
  // exact axe text received from the scan, with no guessed static copy.
  return {
    matched: false,
    ruleId,
    fallback: {
      name: source.help,
      what: source.description,
      who: "",
      why: "",
    },
  };
}
