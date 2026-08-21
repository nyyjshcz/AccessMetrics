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
  const candidateData = {
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
    scores: { siteScores: {}, rank: {}, overall: null, fourPrinciples: {} },
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
  return { root, source, review, candidate, output, localization };
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
});
