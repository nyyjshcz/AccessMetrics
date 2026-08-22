import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { loadReportStyle } from "../../scripts/report-style";

describe("plan CLI argument separators", () => {
  it("accepts pnpm's -- separator before deliverables flags", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-cli-args-"));
    try {
      const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
      const reportData = path.join(root, "report-data.json");
      const outputRoot = path.join(root, "output");
      const evidenceRoot = path.join(root, "evidence");
      fs.writeFileSync(reportData, "{}\n");
      expect(() =>
        execFileSync(
          process.execPath,
          [
            tsx,
            "scripts/deliverables-build.ts",
            "--",
            "--export-id",
            "final-1",
            "--report-data",
            reportData,
            "--output-root",
            outputRoot,
            "--evidence-root",
            evidenceRoot,
          ],
          { encoding: "utf8", stdio: "pipe" },
        ),
      ).toThrowError(/R4 candidate 未通过真人确认/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed for an invalid report style template", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-report-style-"));
    try {
      const styleDirectory = path.join(root, "docs", "templates");
      fs.mkdirSync(styleDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(styleDirectory, "report-style.json"),
        JSON.stringify({ templateVersion: "wrong-version" }),
      );
      expect(() => loadReportStyle(root)).toThrow(/report-style-v1/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
