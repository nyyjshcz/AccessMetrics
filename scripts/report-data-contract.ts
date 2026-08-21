type RecordValue = Record<string, unknown>;

export const CANDIDATE_REPORT_FIELDS = [
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
] as const;

const HEX64 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;

function object(value: unknown, name: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} 必须是对象`);
  return value as RecordValue;
}
function exactKeys(value: RecordValue, keys: readonly string[], name: string) {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.some((key) => !expected.has(key)) || keys.some((key) => !(key in value)))
    throw new Error(`${name} 字段集合不符合固定契约`);
}
function nonNegativeInteger(value: unknown, name: string) {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${name} 必须是非负整数`);
}

export function assertCandidateReportData(data: RecordValue) {
  exactKeys(data, CANDIDATE_REPORT_FIELDS, "candidate report-data");
  if (data.schemaVersion !== "report-data-candidate-v1")
    throw new Error("candidate report-data schemaVersion 必须是 report-data-candidate-v1");
  if (data.artifactKind !== "candidate")
    throw new Error("candidate report-data artifactKind 必须是 candidate");
  for (const field of ["sourceExportId", "studyFreezeId"] as const) {
    if (typeof data[field] !== "string" || data[field].length === 0)
      throw new Error(`candidate report-data ${field} 必须是非空字符串`);
  }
  for (const field of [
    "sourceManifestHash",
    "populationDigest",
    "reviewFreezeHash",
    "reportLocalizationDraftHash",
    "modelDecisionHash",
    "modelObservationsHash",
  ] as const)
    if (typeof data[field] !== "string" || !HEX64.test(data[field]))
      throw new Error(`candidate report-data ${field} 必须是 SHA-256`);
  if (typeof data.createdFromCommit !== "string" || !COMMIT.test(data.createdFromCommit))
    throw new Error("candidate report-data createdFromCommit 必须是 commit SHA");
  for (const field of [
    "provenance",
    "sampleSummary",
    "pageStatusSummary",
    "severitySummary",
    "principleSummary",
    "sensitivity",
  ] as const)
    object(data[field], `candidate report-data.${field}`);
  const frame = object(data.frameCoverageSummary, "candidate report-data.frameCoverageSummary");
  exactKeys(
    frame,
    ["frameTotal", "tested", "skipped", "errors", "limitedPages"],
    "frameCoverageSummary",
  );
  for (const field of ["frameTotal", "tested", "skipped", "errors", "limitedPages"])
    nonNegativeInteger(frame[field], `frameCoverageSummary.${field}`);
  const scores = object(data.scores, "candidate report-data.scores");
  exactKeys(scores, ["siteScores", "rank", "overall", "fourPrinciples"], "scores");
  object(scores.siteScores, "scores.siteScores");
  object(scores.rank, "scores.rank");
  if (scores.overall !== null) object(scores.overall, "scores.overall");
  object(scores.fourPrinciples, "scores.fourPrinciples");
  if (!Array.isArray(data.commonRules)) throw new Error("commonRules 必须是数组");
  if (!Array.isArray(data.limitations) || data.limitations.some((item) => typeof item !== "string"))
    throw new Error("limitations 必须是字符串数组");
  const manual = object(data.manualValidation, "candidate report-data.manualValidation");
  exactKeys(
    manual,
    [
      "populationSize",
      "targetSize",
      "samplerVersion",
      "confirmedCount",
      "notAnIssueCount",
      "uncertainCount",
      "agreementCount",
      "disagreementCount",
      "agreementRate",
      "kappa",
      "kappaNullReason",
      "interpretationScope",
    ],
    "manualValidation",
  );
  for (const field of [
    "populationSize",
    "targetSize",
    "confirmedCount",
    "notAnIssueCount",
    "uncertainCount",
    "agreementCount",
    "disagreementCount",
  ])
    nonNegativeInteger(manual[field], `manualValidation.${field}`);
  if (typeof manual.targetSize !== "number" || manual.targetSize > 40)
    throw new Error("manualValidation.targetSize 必须在 0–40");
  if (manual.samplerVersion !== "manual-review-sampler-v1")
    throw new Error("manualValidation.samplerVersion 不符合固定版本");
  if (
    manual.agreementRate !== null &&
    (typeof manual.agreementRate !== "number" ||
      manual.agreementRate < 0 ||
      manual.agreementRate > 1)
  )
    throw new Error("manualValidation.agreementRate 无效");
  if (
    manual.kappa !== null &&
    (typeof manual.kappa !== "number" || manual.kappa < -1 || manual.kappa > 1)
  )
    throw new Error("manualValidation.kappa 无效");
  if (typeof manual.kappaNullReason !== "string" && manual.kappaNullReason !== null)
    throw new Error("manualValidation.kappaNullReason 无效");
  if (typeof manual.interpretationScope !== "string")
    throw new Error("manualValidation.interpretationScope 无效");
  if (!Array.isArray(data.charts)) throw new Error("charts 必须是数组");
  for (const [index, chartValue] of data.charts.entries()) {
    const chart = object(chartValue, `charts[${index}]`);
    exactKeys(chart, ["path", "sha256", "kind"], `charts[${index}]`);
    if (typeof chart.path !== "string" || !/^(charts|tables)\/[^/]+$/.test(chart.path))
      throw new Error(`charts[${index}].path 不安全`);
    if (typeof chart.sha256 !== "string" || !HEX64.test(chart.sha256))
      throw new Error(`charts[${index}].sha256 无效`);
    if (chart.kind !== "png" && chart.kind !== "data")
      throw new Error(`charts[${index}].kind 无效`);
  }
}
