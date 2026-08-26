import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const requiredFiles = [
  "README.md",
  "EXTERNAL_INPUTS.md",
  "docs/architecture.md",
  "docs/data-dictionary.md",
  "docs/scoring-explained.md",
  "docs/standards-crosswalk.md",
  "docs/operations.md",
  "docs/document-qa-log.md",
  "docs/dependency-baseline.md",
  "docs/release-notes.md",
  "docs/templates/report-style.json",
  "deliverables/final-deliverables-checklist.md",
  "deliverables/acceptance-materials/README.md",
  "notebooks/README.md",
  "analysis/notebooks/accesscheck_analysis.ipynb",
  "contracts/external-delivery-attestation.schema.json",
];
const requiredReadmeText = [
  "系统效果",
  "前置环境",
  "docker compose up --build",
  "Web、Worker 和 egress-proxy",
  "pnpm test:all",
  "pnpm scan:site",
  "pnpm deliverables:verify",
  "Jupyter",
  "pnpm backup:create",
  "域名、DNS、HTTPS",
  "CSRF",
  "限速",
  "升级规则",
  "自动评分",
  "EXTERNAL_INPUTS.md",
  "pnpm project:resume",
];
const requiredCommands = [
  "dev",
  "worker",
  "build",
  "lint",
  "format:check",
  "typecheck",
  "test",
  "test:integration",
  "test:e2e",
  "test:analysis",
  "test:scoring-parity",
  "dependency:preflight",
  "contract:check",
  "db:migrate",
  "db:check",
  "egress:check",
  "ops:check",
  "test:all",
  "docs:check",
  "project:status",
  "project:resume",
  "release:verify",
  "release:image",
  "release:publish-check",
  "release:abort",
  "publication:preflight",
  "deliverables:candidate",
  "deliverables:build",
  "deliverables:render",
  "deliverables:verify",
  "backup:create",
  "backup:restore",
];

const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
const readme = read("README.md");
const missingReadmeText = requiredReadmeText.filter((text) => !readme.includes(text));
const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
const missingCommands = requiredCommands.filter((command) => !packageJson.scripts?.[command]);
const localLinks = [...readme.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)/g)].map(
  (match) => match[1],
);
const brokenLinks = localLinks
  .filter((link) => !/^(?:https?:|mailto:)/i.test(link))
  .filter((link) => !fs.existsSync(path.resolve(root, link)));
const externalInputs = read("EXTERNAL_INPUTS.md");
const missingStateContract = [
  "WAITING_EXTERNAL_INPUT",
  "R1",
  "R2",
  "R3",
  "R4",
  "R5",
  "project:resume",
].filter((term) => !externalInputs.includes(term));

const result = {
  passed:
    missingFiles.length === 0 &&
    missingReadmeText.length === 0 &&
    missingCommands.length === 0 &&
    brokenLinks.length === 0 &&
    missingStateContract.length === 0,
  missingFiles,
  missingReadmeText,
  missingCommands,
  brokenLinks,
  missingStateContract,
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
