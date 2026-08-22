import fs from "node:fs";
import path from "node:path";
const contract = fs.readFileSync(path.join(process.cwd(), "contracts", "api.openapi.yaml"), "utf8");
for (const route of [
  "/api/health",
  "/api/scans",
  "/api/scans/{jobId}",
  "/api/runs/{runId}",
  "/api/runs/{runId}/issues",
  "/api/admin/login",
  "/api/admin/session",
  "/api/reviewer/login",
  "/api/reviewer/session",
  "/api/admin/scans/{jobId}/cancel",
  "/api/admin/review-batches",
  "/api/admin/review-freezes",
  "/api/admin/study-freezes/{freezeId}/finalize",
  "/api/gates/evidence",
  "/api/reviewer/r5/status",
  "/api/reviewer/r5/exercises",
  "/api/reviewer/r5/understanding-checks",
  "/api/reviewer/r5/handoffs",
  "/api/reviewer/nodes/{nodeId}/reviews",
  "/api/reviewer/review-batches/{batchId}/samples/{sampleId}/reviews",
  "/api/reviewer/review-batches/{batchId}/samples/{sampleId}/adjudications",
  "/api/reviewer/adjudications/{id}/approve",
])
  if (!contract.includes(route)) throw new Error(`missing contract route ${route}`);
const schema = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "contracts", "scan-export.schema.json"), "utf8"),
);
if (schema.properties.schemaVersion.const !== "scan-export-v1")
  throw new Error("export schema mismatch");
for (const file of [
  "manifest.schema.json",
  "study-export.schema.json",
  "campaign-plan.schema.json",
  "campaign-execution-log.schema.json",
  "human-gate-receipt.schema.json",
  "release-validation-attestation.schema.json",
  "release-build-attestation.schema.json",
  "publication-privacy-report.schema.json",
  "publication-approval.schema.json",
  "r5-exercise.schema.json",
  "r5-understanding-check.schema.json",
  "r5-handoff.schema.json",
  "r5-artifact-bundle.schema.json",
  "report-data.schema.json",
  "report-data-candidate.schema.json",
  "candidate-bundle.schema.json",
  "rule-localizations.schema.json",
]) {
  const value = JSON.parse(fs.readFileSync(path.join(process.cwd(), "contracts", file), "utf8"));
  if (!value.$schema || (typeof value.type !== "string" && !value.allOf))
    throw new Error(`invalid contract ${file}`);
}
const localization = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scoring", "rule-localizations.zh-CN.json"), "utf8"),
);
if (
  localization.schemaVersion !== "rule-localizations.zh-CN-v1" ||
  localization.status !== "ai_draft_waiting_R1_review" ||
  !localization.rules ||
  Object.keys(localization.rules).length !== 105
)
  throw new Error("rule localization catalog is incomplete or incorrectly marked");
for (const [ruleId, entry] of Object.entries(localization.rules) as Array<
  [string, Record<string, unknown>]
>) {
  const required = [
    "ruleId",
    "sourceDescription",
    "sourceHelp",
    "sourceVersion",
    "sourceHash",
    "zhName",
    "zhImpact",
    "zhFix",
    "manualCheck",
    "translationStatus",
    "reviewer",
    "reviewedAt",
  ];
  if (entry.ruleId !== ruleId || required.some((field) => !(field in entry)))
    throw new Error(`invalid localization entry: ${ruleId}`);
  if (entry.translationStatus !== "ai_draft" && entry.translationStatus !== "human_reviewed")
    throw new Error(`invalid localization status: ${ruleId}`);
}
const reportDataSchema = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "contracts", "report-data.schema.json"), "utf8"),
);
const requiredReportFields = [
  "schemaVersion",
  "exportId",
  "manifestHash",
  "sourceExportId",
  "sourceManifestHash",
  "studyFreezeId",
  "populationDigest",
  "outcomeDigest",
  "reviewFreezeHash",
  "modelDecisionHash",
  "modelObservationsHash",
  "r4EvidenceBundleHash",
  "scanTimeLocalizationHash",
  "reportLocalizationHash",
  "generatedAt",
  "provenance",
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
];
if (!requiredReportFields.every((field) => reportDataSchema.required?.includes(field)))
  throw new Error("report-data schema does not lock all report traceability fields");
const candidateReportSchema = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "contracts", "report-data-candidate.schema.json"),
    "utf8",
  ),
);
const candidateRequiredFields = [
  "schemaVersion",
  "artifactKind",
  "sourceExportId",
  "sourceManifestHash",
  "studyFreezeId",
  "populationDigest",
  "reviewFreezeHash",
  "reportLocalizationDraftHash",
  "modelDecisionHash",
  "modelObservationsHash",
  "createdFromCommit",
  "scores",
  "manualValidation",
  "frameCoverageSummary",
  "charts",
  "limitations",
];
if (!candidateRequiredFields.every((field) => candidateReportSchema.required?.includes(field)))
  throw new Error("candidate report-data schema does not lock candidate traceability/stat fields");
for (const forbidden of ["exportId", "manifestHash", "outcomeDigest", "r4EvidenceBundleHash"])
  if (candidateReportSchema.properties?.[forbidden])
    throw new Error(`candidate report-data schema illegally exposes final field: ${forbidden}`);
for (const field of [
  "frameCoverageSummary",
  "scores",
  "manualValidation",
  "charts",
  "limitations",
]) {
  const reference = candidateReportSchema.properties?.[field]?.["$ref"];
  if (reference !== `report-data.schema.json#/$defs/${field}`)
    throw new Error(`candidate report-data must share report-data $defs for ${field}`);
  if (!reportDataSchema.$defs?.[field])
    throw new Error(`report-data schema missing shared $defs.${field}`);
}
const candidateBundleSchema = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "contracts", "candidate-bundle.schema.json"), "utf8"),
);
const candidateBundleRequired = [
  "schemaVersion",
  "candidateBundleId",
  "sourceExportId",
  "sourceManifestHash",
  "studyFreezeId",
  "populationDigest",
  "reviewFreezeHash",
  "reportLocalizationDraftHash",
  "modelDecisionHash",
  "modelObservationsHash",
  "createdFromCommit",
  "files",
];
if (!candidateBundleRequired.every((field) => candidateBundleSchema.required?.includes(field)))
  throw new Error("candidate-bundle schema does not lock all required bindings");
const examplesDir = path.join(process.cwd(), "contracts", "examples");
for (const file of fs.readdirSync(examplesDir).filter((name) => name.endsWith(".json"))) {
  const example = JSON.parse(fs.readFileSync(path.join(examplesDir, file), "utf8"));
  if (!example || typeof example !== "object") throw new Error(`invalid contract example ${file}`);
}
const manifestExample = JSON.parse(
  fs.readFileSync(path.join(examplesDir, "manifest.json"), "utf8"),
);
if (
  manifestExample.schemaVersion !== "canonical-manifest-json-v1" ||
  !Array.isArray(manifestExample.files)
)
  throw new Error("manifest example does not match manifest contract");
const issueExample = JSON.parse(
  fs.readFileSync(path.join(examplesDir, "issues.page.json"), "utf8"),
);
if (!issueExample.pagination || !Array.isArray(issueExample.items))
  throw new Error("issues example does not use the standard pagination envelope");
console.log("API and export contracts passed");
