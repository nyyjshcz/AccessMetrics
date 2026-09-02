/** The human-authored, source-independent copy shown for one axe rule. */
export type AxeRuleCopyText = {
  name: string;
  what: string;
  who: string;
  why: string;
};

/** A bilingual static copy entry. Source metadata is attached by the resolver. */
export type StaticAxeRuleCopy = {
  en: AxeRuleCopyText;
  zh: AxeRuleCopyText;
};
