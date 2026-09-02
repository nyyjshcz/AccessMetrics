// Public entry point for the static, source-pinned rule explanations used by
// the site-wide violation summary view.
export {
  AXE_RULE_EXPLANATIONS,
  AXE_RULE_EXPLANATION_COUNT,
  axeRuleSourceHash,
  getAxeRuleExplanation,
} from "./axe-rule-explanations";
export type { RuleExplanation, RuleExplanationResult } from "./axe-rule-explanations";
