import fs from "node:fs";
import path from "node:path";
import axeCatalog from "../configs/axe-rule-catalog.json";
import { canonicalize, sha256 } from "../src/lib/canonical";

type ExistingDraft = { name?: string; summary?: string };
const root = process.cwd();
const outputPath = path.join(root, "scoring", "rule-localizations.zh-CN.json");
const existing = fs.existsSync(outputPath)
  ? (JSON.parse(fs.readFileSync(outputPath, "utf8")) as { rules?: Record<string, ExistingDraft> })
  : {};
const rules: Record<string, unknown> = {};
for (const rule of axeCatalog.rules) {
  const draft = existing.rules?.[rule.id] ?? {};
  const source = {
    ruleId: rule.id,
    sourceDescription: rule.description,
    sourceHelp: rule.help,
    sourceHelpUrl: rule.helpUrl,
    sourceVersion: `axe-core-${axeCatalog.axeVersion}`,
    tags: rule.tags,
  };
  rules[rule.id] = {
    ruleId: rule.id,
    sourceDescription: rule.description,
    sourceHelp: rule.help,
    sourceVersion: `axe-core-${axeCatalog.axeVersion}`,
    sourceHash: sha256(canonicalize(source)),
    zhName: draft.name ?? "暂无人工校对中文说明",
    zhImpact: rule.impact ?? "保留 axe 原始严重程度；暂无人工中文解释",
    zhFix: draft.summary ?? "请查看 axe 原文和官方帮助链接；中文说明尚未完成人工校对。",
    manualCheck: "需要结合页面语境进行人工确认",
    translationStatus: "ai_draft",
  };
}
fs.writeFileSync(
  outputPath,
  `${JSON.stringify({ schemaVersion: "rule-localizations.zh-CN-v1", status: "ai_draft", rules }, null, 2)}\n`,
);
console.log(`generated ${Object.keys(rules).length} AI-draft localizations`);
