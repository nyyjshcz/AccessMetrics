import fs from "node:fs";
import path from "node:path";
import { canonicalize, sha256 } from "./canonical";
import { AppError } from "./errors";

export interface PrivacyFinding {
  ruleId: string;
  path: string;
  location: string;
  severity: "high" | "warning";
  fingerprint: string;
  resolution: string;
}
const secretPatterns: Array<[string, RegExp, "high" | "warning"]> = [
  [
    "secret-token",
    /(?:api[_-]?key|authorization|bearer|password|secret)\s*[:=]\s*["']?[^\s"']{8,}/i,
    "high",
  ],
  ["cookie", /set-cookie|document\.cookie/i, "high"],
  ["email", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "warning"],
  ["phone", /(?<!\d)1[3-9]\d{9}(?!\d)/, "warning"],
  ["private-path", /(?:[A-Z]:\\Users\\|\/Users\/|C:\\ai\\)/i, "warning"],
  ["raw-html", /<html[\s>]/i, "high"],
];
export function scanPublicationDirectory(root: string, exportId: string) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) throw new AppError("PACKAGE_NOT_FOUND", "公开包目录不存在", 404);
  const files: Array<{ path: string; bytes: Buffer }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(resolved, full).replaceAll(path.sep, "/");
      if (entry.isSymbolicLink())
        throw new AppError("PACKAGE_SYMLINK", `禁止符号链接: ${rel}`, 422);
      if (entry.isDirectory()) walk(full);
      else files.push({ path: rel, bytes: fs.readFileSync(full) });
    }
  };
  walk(resolved);
  const seen = new Set<string>();
  const findings: PrivacyFinding[] = [];
  const checkedFiles = files
    .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
    .map(({ path: filePath, bytes }) => {
      const normalized = filePath.normalize("NFC");
      const folded = normalized.toLocaleLowerCase("en-US");
      if (
        !/^[^/][^\\]*$/.test(normalized) ||
        normalized.split("/").some((part) => part === "." || part === "..") ||
        seen.has(folded)
      )
        findings.push({
          ruleId: "path-safety",
          path: filePath,
          location: "path",
          severity: "high",
          fingerprint: sha256(filePath),
          resolution: "修正路径后重新生成公开包",
        });
      seen.add(folded);
      const text = bytes.toString("utf8");
      for (const [ruleId, pattern, severity] of secretPatterns)
        if (ruleId === "phone" ? containsLikelyPhone(text) : pattern.test(text))
          findings.push({
            ruleId,
            path: filePath,
            location: "content",
            severity,
            fingerprint: sha256(`${ruleId}:${filePath}`),
            resolution: "从上游导出中移除敏感信息并重跑隐私检查",
          });
      return { path: filePath, size: bytes.length, fileSha256: sha256(bytes) };
    });
  const fileAllowlistHash = sha256(canonicalize(checkedFiles.map((file) => file.path)));
  const manifestPath = path.join(resolved, "manifest.json");
  let manifestHash = "";
  if (fs.existsSync(manifestPath)) manifestHash = sha256(fs.readFileSync(manifestPath));
  else
    findings.push({
      ruleId: "manifest-required",
      path: "manifest.json",
      location: "file",
      severity: "high",
      fingerprint: sha256("manifest-required"),
      resolution: "重新生成带 manifest 的导出包",
    });
  const report = {
    schemaVersion: "publication-privacy-report-v1",
    rulesetVersion: "publication-privacy-rules-v1",
    exportId,
    manifestHash,
    fileAllowlistHash,
    checkedFiles,
    findings: findings.sort((a, b) =>
      `${a.path}:${a.ruleId}`.localeCompare(`${b.path}:${b.ruleId}`),
    ),
    passed: findings.length === 0,
    generatedAt: new Date().toISOString(),
  };
  const privacyCheckHash = sha256(
    canonicalize({ ...report, generatedAt: undefined, privacyCheckHash: undefined }),
  );
  return { ...report, privacyCheckHash };
}

function containsLikelyPhone(text: string) {
  const pattern = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const before = text.slice(Math.max(0, start - 32), start);
    const after = text.slice(start + match[0].length, start + match[0].length + 32);
    // A run of digits embedded in a SHA-256/hex identifier is not a phone number.
    if (/[a-f0-9]{16,}$/i.test(before) || /^[a-f0-9]{16,}/i.test(after)) continue;
    return true;
  }
  return false;
}
