import fs from "node:fs";
import path from "node:path";
const contract = fs.readFileSync(path.join(process.cwd(), "contracts", "api.openapi.yaml"), "utf8");
function routeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute);
    return entry.isFile() && entry.name === "route.ts" ? [absolute] : [];
  });
}

function sourceRoutePath(file: string) {
  const relative = path
    .relative(path.join(process.cwd(), "src", "app"), file)
    .replaceAll("\\", "/")
    .replace(/\/route\.ts$/, "");
  return `/${relative.replace(/\[([^\]]+)\]/g, "{$1}")}`;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;

function sourceRouteMethods(file: string) {
  const source = fs.readFileSync(file, "utf8");
  const methods = new Set<string>();
  for (const method of HTTP_METHODS) {
    const upper = method.toUpperCase();
    // Route handlers are deliberately detected from the source rather than
    // importing the module.  Importing would execute application startup and
    // make a contract check depend on secrets, a database, or a browser.
    if (
      new RegExp(`\\bexport\\s+(?:async\\s+function|const)\\s+${upper}\\b`).test(source) ||
      new RegExp(`\\bexport\\s*\\{[^}]*\\b${upper}\\b[^}]*\\}`).test(source)
    )
      methods.add(method);
  }
  return [...methods].sort();
}

const normalizePath = (value: string) => value.replace(/\{[^}]+\}/g, "{}");
const documentedPaths = new Set(
  [...contract.matchAll(/^  (\/api\/[^:]+):$/gm)].map((match) => normalizePath(match[1])),
);
const sourceRoutes = routeFiles(path.join(process.cwd(), "src", "app", "api")).map((file) => ({
  file,
  route: sourceRoutePath(file),
  methods: sourceRouteMethods(file),
}));
const undocumentedRoutes = sourceRoutes
  .map(({ route }) => route)
  .filter((route) => !documentedPaths.has(normalizePath(route)))
  .sort();
if (undocumentedRoutes.length)
  throw new Error(`OpenAPI 缺少源码路由: ${undocumentedRoutes.join(", ")}`);

function documentedMethods(route: string) {
  const pathBlock = [
    ...contract.matchAll(
      /^  (\/api\/[^:]+):\r?\n(.*?)(?=^  \/api\/[^:]+:|^components:|(?![\s\S]))/gms,
    ),
  ].find((match) => normalizePath(match[1]) === normalizePath(route))?.[2];
  if (!pathBlock) return [] as string[];
  return [...pathBlock.matchAll(/^    (get|post|put|patch|delete|options|head):/gm)]
    .map((match) => match[1])
    .sort();
}

const undocumentedMethods = sourceRoutes
  .flatMap(({ route, methods }) => {
    const documented = new Set(documentedMethods(route));
    return methods
      .filter((method) => !documented.has(method))
      .map((method) => `${method.toUpperCase()} ${route}`);
  })
  .sort();
if (undocumentedMethods.length)
  throw new Error(`OpenAPI 缺少源码方法: ${undocumentedMethods.join(", ")}`);
for (const route of [
  "/api/health",
  "/api/scans",
  "/api/scans/{jobId}",
  "/api/runs/{runId}",
  "/api/runs/{runId}/issues",
  "/api/runs/{runId}/review-workbench",
  "/api/runs/{runId}/formal-review-status",
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
const runExportSchema = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "contracts", "run-export.schema.json"), "utf8"),
);
const runExportRequired = [
  "schemaVersion",
  "exportId",
  "generatedAt",
  "site",
  "run",
  "configSnapshot",
  "pages",
  "ruleResults",
  "resultNodes",
  "pageScores",
  "siteScore",
  "reviewRefs",
  "provenance",
];
if (
  runExportSchema.properties.schemaVersion.const !== "scan-export-v1" ||
  !runExportRequired.every((field) => runExportSchema.required?.includes(field)) ||
  runExportSchema.additionalProperties !== false
)
  throw new Error("run export contract does not lock the complete traceable DTO");
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
const csvContract = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "contracts", "study-csv-columns.v1.json"), "utf8"),
);
const expectedCsvTables = [
  "sites.csv",
  "runs.csv",
  "pages.csv",
  "rule_results.csv",
  "result_nodes.csv",
  "page_scores.csv",
  "site_scores.csv",
  "manual_review_batches.csv",
  "manual_review_samples.csv",
  "manual_reviews.csv",
  "manual_review_adjudications.csv",
  "job_pages.csv",
];
if (
  csvContract.schemaVersion !== "study-csv-columns-v1" ||
  csvContract.encoding !== "UTF-8 with BOM" ||
  csvContract.lineEnding !== "CRLF" ||
  expectedCsvTables.some((filename) => !Array.isArray(csvContract.tables?.[filename]?.columns))
)
  throw new Error("study CSV column contract is incomplete");
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
