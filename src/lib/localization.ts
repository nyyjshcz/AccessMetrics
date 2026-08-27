import localizationCatalog from "../../scoring/rule-localizations.zh-CN.json";

export type RuleLocalization = {
  ruleId: string;
  sourceDescription: string;
  sourceHelp: string;
  sourceVersion: string;
  sourceHash: string;
  zhName: string;
  zhImpact: string;
  zhFix: string;
  manualCheck: string;
  translationStatus: string;
  fallback: boolean;
};

const fallback = (ruleId: string): RuleLocalization => ({
  ruleId,
  sourceDescription: "",
  sourceHelp: "",
  sourceVersion: "unknown",
  sourceHash: "0".repeat(64),
  zhName: "暂无人工校对中文说明",
  zhImpact: "保留 axe 原始严重程度；暂无人工中文解释",
  zhFix: "请查看 axe 原文和官方帮助链接；中文说明尚未完成人工校对。",
  manualCheck: "需要结合页面语境进行人工确认",
  translationStatus: "ai_draft",
  fallback: true,
});

export function getRuleLocalization(ruleId: string): RuleLocalization {
  const entry = localizationCatalog.rules[ruleId as keyof typeof localizationCatalog.rules];
  return entry ? ({ ...entry, fallback: false } as RuleLocalization) : fallback(ruleId);
}
