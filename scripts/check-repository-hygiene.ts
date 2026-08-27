import fs from "node:fs";
import path from "node:path";

/** Repository-side publication hygiene check. */
const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  ".pnpm-store",
  "data",
  "artifacts",
  "reports",
  "playwright-report",
  "test-results",
  "private-inputs",
]);
const ignoredPrefixes = [path.join("analysis", "outputs")];
const maxBytes = 5 * 1024 * 1024;
const findings: Array<{ ruleId: string; path: string; detail: string }> = [];
const scanned: string[] = [];

function relative(absolute: string) {
  return path.relative(root, absolute).replaceAll(path.sep, "/");
}

function isIgnored(relativePath: string) {
  const parts = relativePath.split("/");
  return (
    parts.some((part) => ignoredDirectories.has(part)) ||
    ignoredPrefixes.some(
      (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
    ) ||
    /\.db(?:-wal|-shm)?$/i.test(relativePath) ||
    /\.py[co]$/i.test(relativePath) ||
    relativePath === "tsconfig.tsbuildinfo"
  );
}

function isPlaceholder(value: string) {
  return /(?:e2e|test|fixture|example|development|change[-_]?me|placeholder|dummy)/i.test(value);
}

function inspectFile(absolute: string) {
  const filePath = relative(absolute);
  if (isIgnored(filePath)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    findings.push({ ruleId: "symlink", path: filePath, detail: "版本库候选文件不允许符号链接" });
    return;
  }
  if (!stat.isFile()) return;
  scanned.push(filePath);
  if (stat.size > maxBytes)
    findings.push({
      ruleId: "large-file",
      path: filePath,
      detail: `文件 ${stat.size} bytes 超过 ${maxBytes} bytes 版本库上限`,
    });
  if (/^(?:\.env|.*\.(?:pem|key|p12|pfx|jks|crt))$/i.test(path.basename(filePath))) {
    findings.push({
      ruleId: "secret-file",
      path: filePath,
      detail: "疑似密钥/证书文件不得进入版本库",
    });
    return;
  }
  const bytes = fs.readFileSync(absolute);
  if (bytes.includes(0)) return;
  const text = bytes.toString("utf8");
  const highConfidence = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
    /\b(?:xoxb|xoxp)-[0-9A-Za-z-]{20,}\b/,
    /(?:authorization|bearer|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._+/=-]{24,}/i,
  ];
  for (const pattern of highConfidence) {
    const match = text.match(pattern);
    if (match && !isPlaceholder(match[0])) {
      findings.push({
        ruleId: "secret-content",
        path: filePath,
        detail: "检测到高置信度凭据模式；请移到外部 secret store",
      });
      break;
    }
  }
}

function walk(directory: string) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isIgnored(relative(absolute))) walk(absolute);
    } else inspectFile(absolute);
  }
}

if (process.argv.includes("--help")) {
  console.log("usage: pnpm hygiene:check");
  process.exit(0);
}

walk(root);
for (const required of [".gitignore", "THIRD_PARTY_NOTICES.md", "docs/dependency-baseline.md"]) {
  if (!fs.existsSync(path.join(root, required)))
    findings.push({ ruleId: "required-governance-file", path: required, detail: "文件缺失" });
}
const gitignore = fs.existsSync(path.join(root, ".gitignore"))
  ? fs.readFileSync(path.join(root, ".gitignore"), "utf8")
  : "";
for (const pattern of [".env", "private-inputs/", "data/exports/", "*.db"]) {
  if (!gitignore.includes(pattern))
    findings.push({ ruleId: "gitignore-policy", path: ".gitignore", detail: `缺少 ${pattern}` });
}

const result = {
  passed: findings.length === 0,
  scannedFileCount: scanned.length,
  maxBytes,
  findings: findings.sort((a, b) => `${a.path}:${a.ruleId}`.localeCompare(`${b.path}:${b.ruleId}`)),
};
console.log(JSON.stringify(result, null, 2));
if (findings.length) process.exitCode = 1;
