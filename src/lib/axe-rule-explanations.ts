import axeCatalog from "../../configs/axe-rule-catalog.json";
import { canonicalize, sha256 } from "./canonical";

export type RuleExplanation = {
  ruleId: string;
  sourceDescription: string;
  sourceHelp: string;
  sourceHelpUrl: string;
  sourceVersion: string;
  sourceHash: string;
  en: { name: string; what: string; who: string; why: string };
  zh: { name: string; what: string; who: string; why: string };
};

type RawRule = (typeof axeCatalog.rules)[number];
type SourceRule = Pick<RawRule, "id" | "description" | "help" | "helpUrl" | "tags">;

const sourceFor = (rule: SourceRule) => ({
  sourceDescription: rule.description,
  sourceHelp: rule.help,
});

export function axeRuleSourceHash(rule: SourceRule): string {
  return sha256(canonicalize(sourceFor(rule)));
}

const knownChinese: Record<string, [string, string, string, string]> = {
  "image-alt": [
    "图像替代文本",
    "页面中的图像需要可被理解的替代文本。",
    "依赖屏幕阅读器或无法查看图像的用户",
    "没有替代文本时，图像信息可能对这些用户不可用。",
  ],
  "button-name": [
    "按钮名称",
    "按钮需要有可识别的名称。",
    "使用屏幕阅读器或语音控制的用户",
    "没有名称时，用户难以知道按钮的用途。",
  ],
  "color-contrast": [
    "颜色对比度",
    "前景色与背景色需要有足够的对比度。",
    "低视力、色觉差异或在强光环境下使用页面的用户",
    "对比度不足会让文字和控件难以辨认。",
  ],
  "html-has-lang": [
    "页面语言",
    "HTML 文档需要声明页面的主要语言。",
    "使用屏幕阅读器或翻译工具的用户",
    "语言声明帮助辅助技术选择正确的发音和语言规则。",
  ],
};

const chineseTerms: Record<string, string> = {
  aria: "ARIA 属性", alt: "替代文本", button: "按钮", caption: "表格标题",
  color: "颜色", contrast: "颜色对比度", dialog: "对话框", document: "文档",
  focus: "键盘焦点", form: "表单", heading: "标题", html: "HTML 文档",
  iframe: "嵌入框架", image: "图像", input: "输入控件", label: "标签",
  lang: "语言标记", landmark: "地标区域", link: "链接", list: "列表",
  menu: "菜单", name: "可访问名称", role: "语义角色", table: "表格",
  target: "交互目标", title: "标题", video: "视频", audio: "音频",
};

function chineseSubject(rule: RawRule): string {
  const terms = rule.id.split("-").map((part) => chineseTerms[part]).filter(Boolean);
  return terms.length ? [...new Set(terms)].join("与") : "页面内容与交互";
}

const catalog = Object.fromEntries(
  (axeCatalog.rules as RawRule[]).map((rule) => {
    const subject = chineseSubject(rule);
    const zh = knownChinese[rule.id] ?? [
      `${subject}无障碍检查`,
      `检查页面中的${subject}是否符合无障碍要求。`,
      "依赖无障碍内容和辅助技术的用户",
      "满足这项要求有助于让更多用户理解和使用页面。",
    ];
    return [rule.id, {
      ruleId: rule.id,
      sourceDescription: rule.description,
      sourceHelp: rule.help,
      sourceHelpUrl: rule.helpUrl,
      sourceVersion: `axe-core-${axeCatalog.axeVersion}`,
      // Keep the catalog tied to the exact scan-time axe source. Only the
      // human-readable axe description/help are identity-bearing; metadata
      // such as tags can differ in API result rows without changing meaning.
      sourceHash: axeRuleSourceHash(rule),
      en: {
        name: rule.help,
        what: rule.description,
        who: "People who rely on accessible content and assistive technology.",
        why: "Meeting this requirement helps people understand and use the page.",
      },
      zh: { name: zh[0], what: zh[1], who: zh[2], why: zh[3] },
    } satisfies RuleExplanation];
  }),
) as Record<string, RuleExplanation>;

export const AXE_RULE_EXPLANATIONS = catalog;
export const AXE_RULE_EXPLANATION_COUNT = Object.keys(catalog).length;

export type RuleExplanationResult =
  | { matched: true; explanation: RuleExplanation }
  | { matched: false; ruleId: string; fallback: { name: string; what: string; who: string; why: string } };

/** Resolve only when the scan's stored axe source is the catalog source. */
export function getAxeRuleExplanation(
  ruleId: string,
  source: Pick<SourceRule, "description" | "help" | "helpUrl"> & { tags?: string[] },
): RuleExplanationResult {
  const entry = catalog[ruleId];
  // API result rows may omit tags; recover them from the pinned axe catalog
  // while still hashing the scan's description/help values.
  const pinned = (axeCatalog.rules as RawRule[]).find((rule) => rule.id === ruleId);
  const sourceRule = {
    id: ruleId,
    ...source,
    tags: source.tags?.length ? source.tags : pinned?.tags ?? [],
  } as SourceRule;
  if (entry && entry.sourceHash === axeRuleSourceHash(sourceRule)) {
    return { matched: true, explanation: entry };
  }
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
