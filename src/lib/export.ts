import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { config } from "./config";
import { id } from "./ids";
import { buildRunScore } from "./run-score";
import { canonicalize, sha256 } from "./canonical";

export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  // Prefix spreadsheet formula characters so exported evidence cannot become
  // an executable formula when opened by Excel/LibreOffice.
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function exportRun(runId: string) {
  const run = getDb()
    .prepare(
      "SELECT r.*,s.origin,s.name FROM scan_runs r JOIN sites s ON s.id=r.site_id WHERE r.id=?",
    )
    .get(runId) as any;
  if (!run) throw new Error("run not found");
  const existing = getDb()
    .prepare(
      "SELECT id,path,manifest_hash FROM exports WHERE run_id=? AND kind='run' AND status='verified' ORDER BY created_at DESC LIMIT 1",
    )
    .get(runId) as { id: string; path: string; manifest_hash: string } | undefined;
  if (existing && fs.existsSync(existing.path))
    return {
      exportId: existing.id,
      target: existing.path,
      manifestHash: existing.manifest_hash,
      files: [],
    };
  const exportId = id("export");
  const target = path.join(config.privateEvidenceRoot, "exports", exportId);
  fs.mkdirSync(target, { recursive: true });
  const issues = getDb()
    .prepare(
      "SELECT rr.*,p.canonical_url FROM rule_results rr JOIN pages p ON p.id=rr.page_id WHERE rr.run_id=? ORDER BY p.canonical_url,rr.rule_id,rr.result_type",
    )
    .all(runId) as any[];
  const pages = getDb()
    .prepare(
      "SELECT canonical_url,scan_status,http_status,error_code,frame_total,same_origin_frame_total,cross_origin_frame_total,frame_tested_total,frame_skipped_total,frame_error_count,frame_coverage_status,frame_coverage_issues_json,axe_timestamp,axe_test_engine_json,axe_test_environment_json,axe_tool_options_json FROM pages WHERE run_id=? ORDER BY canonical_url",
    )
    .all(runId) as any[];
  const payload = {
    schemaVersion: "scan-export-v1",
    exportId,
    run,
    score: buildRunScore(runId),
    pages,
    issues: issues.map((row) => {
      const { tags_json: _tagsJson, raw_json: _rawJson, ...rest } = row;
      return { ...rest, tags: JSON.parse(row.tags_json), raw: JSON.parse(row.raw_json) };
    }),
  };
  const jsonBytes = Buffer.from(canonicalize(payload) + "\n", "utf8");
  fs.writeFileSync(path.join(target, "scan.json"), jsonBytes);
  const columns = [
    "canonical_url",
    "rule_id",
    "result_type",
    "impact",
    "description",
    "help_url",
    "node_count",
  ];
  const csv =
    [
      columns.join(","),
      ...issues.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
    ].join("\n") + "\n";
  fs.writeFileSync(path.join(target, "issues.csv"), csv);
  const files = ["scan.json", "issues.csv"].map((file) => {
    const bytes = fs.readFileSync(path.join(target, file));
    return { path: file, size: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = {
    schemaVersion: "canonical-manifest-json-v1",
    exportId,
    files,
    generatedAt: new Date().toISOString(),
  };
  const manifestBytes = Buffer.from(canonicalize(manifest) + "\n");
  fs.writeFileSync(path.join(target, "manifest.json"), manifestBytes);
  fs.writeFileSync(path.join(target, "manifest.sha256"), `${sha256(manifestBytes)}\n`);
  const manifestHash = sha256(manifestBytes);
  getDb()
    .prepare("UPDATE scan_runs SET export_id=?,manifest_hash=? WHERE id=?")
    .run(exportId, manifestHash, runId);
  getDb()
    .prepare(
      "INSERT INTO exports(id,run_id,kind,path,manifest_hash,created_at,status) VALUES (?,?,?,?,?,?,?)",
    )
    .run(exportId, runId, "run", target, manifestHash, new Date().toISOString(), "verified");
  return { exportId, target, manifestHash, files };
}
