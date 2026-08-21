import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyApprovedGate } from "./gate-utils";

const root = process.cwd();
const externalPath = path.join(root, "EXTERNAL_INPUTS.md");
const statusPath = path.join(root, "IMPLEMENTATION_STATUS.md");
const external = fs.readFileSync(externalPath, "utf8");
const pending = external.split("\n").filter((line) => line.startsWith("- [ ]"));
const required = [
  "package.json",
  "pnpm-lock.yaml",
  "src/lib/db.ts",
  "src/lib/browser.ts",
  "src/lib/scan-page.ts",
  "src/lib/score.ts",
  "src/worker/index.ts",
  "contracts/api.openapi.yaml",
  "tests/e2e/home.spec.ts",
  "analysis/reference_score.py",
  "Dockerfile",
  "docker-compose.yml",
  "scripts/check-repository-hygiene.ts",
  "scripts/check-egress-proxy.mjs",
  "scripts/scan-page-cli.ts",
  "tools/egress-proxy/proxy.mjs",
  "compose.prod.yaml",
  "Caddyfile",
  "scripts/release-verify.ts",
  "scripts/release-image.ts",
  "scripts/release-publish-check.ts",
  "docs/release-notes.md",
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
const evidenceRoot = path.resolve(
  process.env.PRIVATE_EVIDENCE_ROOT ?? path.join(root, "private-inputs"),
);
let earlierGateFailed = false;
const missingEvidence = ["R1", "R2", "R3", "R4", "R5"].filter((gate) => {
  if (earlierGateFailed) return true;
  try {
    verifyApprovedGate(path.join(evidenceRoot, "gates"), gate as "R1" | "R2" | "R3" | "R4" | "R5");
    return false;
  } catch {
    earlierGateFailed = true;
    return true;
  }
});
if (missing.length > 0) {
  console.log(`自动化实现仍缺少 ${missing.length} 个文件，不能续跑真人门。`);
  process.exitCode = 1;
} else if (pending.length > 0 || missingEvidence.length > 0) {
  console.log(
    `仍有 ${pending.length} 项外部输入未确认，或缺少 ${missingEvidence.join(",")} gate evidence，系统保持 WAITING_EXTERNAL_INPUT。`,
  );
  process.exitCode = 2;
} else {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const quality = spawnSync(pnpm, ["test:all"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
    shell: process.platform === "win32",
  });
  if (quality.status !== 0) {
    console.log("自动化质量门未通过，不能续跑真人门。");
    process.exitCode = 1;
    process.exit();
  }
  const status = fs
    .readFileSync(statusPath, "utf8")
    .replace(/当前状态：`[^`]+`/, "当前状态：`READY_FOR_FORMAL_VALIDATION`");
  fs.writeFileSync(statusPath, status);
  console.log("外部输入已齐全，可以继续正式验证。");
}
