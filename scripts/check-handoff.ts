import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const directory = path.join(root, "docs", "owner-handoff");
const required = [
  "00-项目全景图.md",
  "01-计算机负责人学习说明.md",
  "02-数学负责人学习说明.md",
  "03-端到端操作练习.md",
  "04-常见问答.md",
  "05-故障处理速查.md",
  "06-贡献证据索引.md",
  "07-理解检查参考答案与验收表.md",
];
const missing = required.filter((file) => !fs.existsSync(path.join(directory, file)));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const commands = new Set(Object.keys(packageJson.scripts));
const errors: string[] = [];
for (const file of required) {
  if (missing.includes(file)) continue;
  const source = fs.readFileSync(path.join(directory, file), "utf8");
  for (const link of source.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = link[1];
    if (/^https?:\/\//.test(target)) continue;
    if (
      !fs.existsSync(path.resolve(directory, target)) &&
      !fs.existsSync(path.resolve(root, target))
    )
      errors.push(`${file}: missing link ${target}`);
  }
  for (const command of source.matchAll(/pnpm\s+([a-z0-9:_-]+)/gi))
    if (!commands.has(command[1])) errors.push(`${file}: unknown pnpm command ${command[1]}`);
}
const faqCount = (
  fs.readFileSync(path.join(directory, "04-常见问答.md"), "utf8").match(/^\*\*\d+\./gm) ?? []
).length;
const result = {
  passed: missing.length === 0 && errors.length === 0 && faqCount >= 30,
  missing,
  errors,
  faqCount,
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
