import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { canonicalize, sha256 } from "../../src/lib/canonical";

function writeCandidateFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "accesscheck-candidate-"));
  const source = path.join(root, "source");
  const review = path.join(root, "review");
  const candidate = path.join(root, "candidate");
  const output = path.join(root, "bundles");
  for (const directory of [source, review, candidate, output])
    fs.mkdirSync(directory, { recursive: true });
  const localization = path.join(root, "localization.json");
  fs.writeFileSync(localization, '{"status":"ai_draft"}\n');
  fs.writeFileSync(
    path.join(source, "manifest.json"),
    `${JSON.stringify({ schemaVersion: "canonical-manifest-json-v1", exportId: "source-1", files: [] })}\n`,
  );
  fs.writeFileSync(path.join(review, "freeze.json"), "{}\n");
  const reviewBytes = fs.readFileSync(path.join(review, "freeze.json"));
  const reviewFreezeHash = sha256(
    canonicalize([{ path: "freeze.json", bytes: reviewBytes.length, sha256: sha256(reviewBytes) }]),
  );
  fs.writeFileSync(path.join(candidate, "model-decision-record.md"), "decision\n");
  fs.writeFileSync(path.join(candidate, "model-observations.md"), "observations\n");
  const candidateData: Record<string, unknown> = {
    schemaVersion: "report-data-candidate-v1",
    artifactKind: "candidate",
    sourceExportId: "source-1",
    sourceManifestHash: sha256(fs.readFileSync(path.join(source, "manifest.json"))),
    studyFreezeId: "freeze-1",
    populationDigest: "a".repeat(64),
    reviewFreezeHash,
    reportLocalizationDraftHash: sha256(fs.readFileSync(localization)),
    modelDecisionHash: sha256(fs.readFileSync(path.join(candidate, "model-decision-record.md"))),
    modelObservationsHash: sha256(fs.readFileSync(path.join(candidate, "model-observations.md"))),
    createdFromCommit: "b".repeat(40),
    provenance: {},
    sampleSummary: {},
    pageStatusSummary: {},
    frameCoverageSummary: { frameTotal: 0, tested: 0, skipped: 0, errors: 0, limitedPages: 0 },
    scores: {
      siteScores: {},
      rank: {},
      overall: null,
      fourPrinciples: {},
      distribution: {},
      categoryComparison: {},
    },
    severitySummary: {},
    commonRules: [],
    principleSummary: {},
    sensitivity: {},
    manualValidation: {
      populationSize: 0,
      targetSize: 0,
      samplerVersion: "manual-review-sampler-v1",
      confirmedCount: 0,
      notAnIssueCount: 0,
      uncertainCount: 0,
      agreementCount: 0,
      disagreementCount: 0,
      agreementRate: null,
      kappa: null,
      kappaNullReason: "empty",
      interpretationScope: "manual sample only",
    },
    charts: [],
    limitations: [],
  };
  const candidateDataPath = path.join(candidate, "report-data.candidate.json");
  fs.writeFileSync(candidateDataPath, `${JSON.stringify(candidateData)}\n`);
  const candidateDataHash = sha256(fs.readFileSync(candidateDataPath));
  for (const name of ["research-report.md", "federation-report.md"])
    fs.writeFileSync(
      path.join(candidate, name),
      `> REVIEW CANDIDATE — NOT FINAL\nreport-data SHA-256: ${candidateDataHash}\n`,
    );
  const sourceReportDataPath = path.join(root, "source-report-data.json");
  fs.writeFileSync(
    sourceReportDataPath,
    `${JSON.stringify({
      schemaVersion: "report-data-v1",
      exportId: "source-1",
      manifestHash: candidateData.sourceManifestHash,
      sourceExportId: "source-1",
      sourceManifestHash: candidateData.sourceManifestHash,
      studyFreezeId: candidateData.studyFreezeId,
      populationDigest: candidateData.populationDigest,
      outcomeDigest: "c".repeat(64),
      reviewFreezeHash: candidateData.reviewFreezeHash,
      modelDecisionHash: candidateData.modelDecisionHash,
      modelObservationsHash: candidateData.modelObservationsHash,
      r4EvidenceBundleHash: "d".repeat(64),
      scanTimeLocalizationHash: "e".repeat(64),
      reportLocalizationHash: "f".repeat(64),
      generatedAt: "2026-01-01T00:00:00.000Z",
      provenance: { analysisVersion: "accesscheck-analysis-v1", codeCommit: null, versions: [] },
      ...Object.fromEntries(
        [
          "sampleSummary",
          "pageStatusSummary",
          "frameCoverageSummary",
          "scores",
          "severitySummary",
          "commonRules",
          "principleSummary",
          "sensitivity",
          "manualValidation",
          "charts",
          "limitations",
        ].map((field) => [field, candidateData[field]]),
      ),
    })}\n`,
  );
  return { root, source, review, candidate, output, localization, sourceReportDataPath };
}

describe("candidate deliverables", () => {
  it("creates and idempotently reuses a five-file candidate bundle", () => {
    const fixture = writeCandidateFixture();
    try {
      const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
      const command = [
        "scripts/deliverables-candidate.ts",
        "--source-export",
        fixture.source,
        "--review-freeze",
        fixture.review,
        "--report-localization-draft",
        fixture.localization,
        "--candidate-files",
        fixture.candidate,
        "--output-root",
        fixture.output,
      ];
      const first = JSON.parse(
        execFileSync(process.execPath, [tsx, ...command], { encoding: "utf8" }),
      );
      const second = JSON.parse(
        execFileSync(process.execPath, [tsx, ...command], { encoding: "utf8" }),
      );
      expect(first.status).toBe("candidate_only");
      expect(second.status).toBe("reused");
      const bundle = JSON.parse(
        fs.readFileSync(path.join(first.path, "candidate-bundle.json"), "utf8"),
      );
      expect(bundle.files).toHaveLength(5);
      expect(bundle.files.map((file: { path: string }) => file.path)).toEqual(
        [
          "candidate/federation-report.md",
          "candidate/model-decision-record.md",
          "candidate/model-observations.md",
          "candidate/research-report.md",
          "candidate/report-data.candidate.json",
        ].sort(),
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects final report-data fields before writing a bundle", () => {
    const fixture = writeCandidateFixture();
    try {
      const reportDataPath = path.join(fixture.candidate, "report-data.candidate.json");
      const data = JSON.parse(fs.readFileSync(reportDataPath, "utf8"));
      data.exportId = "should-never-be-accepted";
      fs.writeFileSync(reportDataPath, `${JSON.stringify(data)}\n`);
      const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
      expect(() =>
        execFileSync(
          process.execPath,
          [
            tsx,
            "scripts/deliverables-candidate.ts",
            "--source-export",
            fixture.source,
            "--review-freeze",
            fixture.review,
            "--report-localization-draft",
            fixture.localization,
            "--candidate-files",
            fixture.candidate,
            "--output-root",
            fixture.output,
          ],
          { encoding: "utf8", stdio: "pipe" },
        ),
      ).toThrow();
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("derives candidate report-data without copying final identity fields", () => {
    const fixture = writeCandidateFixture();
    try {
      const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
      const output = path.join(fixture.root, "report-data.candidate.json");
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [
            tsx,
            "scripts/analysis-candidate.ts",
            "--source-report-data",
            fixture.sourceReportDataPath,
            "--source-export",
            fixture.source,
            "--review-freeze",
            fixture.review,
            "--model-decision",
            path.join(fixture.candidate, "model-decision-record.md"),
            "--model-observations",
            path.join(fixture.candidate, "model-observations.md"),
            "--created-from-commit",
            "b".repeat(40),
            "--report-localization-draft",
            fixture.localization,
            "--output",
            output,
          ],
          { encoding: "utf8" },
        ),
      );
      const generated = JSON.parse(fs.readFileSync(output, "utf8"));
      expect(result.status).toBe("candidate_created");
      expect(generated.schemaVersion).toBe("report-data-candidate-v1");
      expect(generated.artifactKind).toBe("candidate");
      expect(generated).not.toHaveProperty("exportId");
      expect(generated).not.toHaveProperty("manifestHash");
      expect(generated).not.toHaveProperty("outcomeDigest");
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
