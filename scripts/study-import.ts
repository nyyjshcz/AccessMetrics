import fs from "node:fs";
import path from "node:path";
import { migrate } from "../src/lib/db";
import { upsertSite } from "../src/lib/repositories";
import { sha256 } from "../src/lib/canonical";
import { positionalArgs } from "./cli-args";
const file = positionalArgs()[0];
if (!file) throw new Error("usage: pnpm study:import -- research/sample-frame.csv");
migrate();
const lines = fs.readFileSync(path.resolve(file), "utf8").trim().split(/\r?\n/);
const parseCsv = (line: string) => {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += char;
  }
  values.push(value);
  return values;
};
const header = parseCsv(lines.shift() ?? "");
const required = [
  "candidate_id",
  "site_name",
  "official_url",
  "category",
  "official_evidence_url",
  "inclusion_reason",
  "priority",
  "planned_status",
  "replacement_for",
  "verified_at",
  "verifier_note",
];
if (required.some((field) => !header.includes(field))) throw new Error("sample-frame 缺少固定字段");
const sites = [];
const candidates = new Set<string>();
for (const line of lines) {
  if (!line.trim()) continue;
  const values = parseCsv(line);
  const row = Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
  if (!row.candidate_id || candidates.has(row.candidate_id))
    throw new Error("candidate_id 必须存在且唯一");
  candidates.add(row.candidate_id);
  if (!row.category || !row.inclusion_reason || !row.official_evidence_url)
    throw new Error(`候选 ${row.candidate_id} 缺少类别、官方依据或纳入理由`);
  if (row.official_url && row.planned_status !== "excluded") {
    const official = new URL(row.official_url);
    if (!["http:", "https:"].includes(official.protocol))
      throw new Error(`不允许的官方 URL: ${row.official_url}`);
    sites.push(upsertSite(official.origin, row.site_name, row.category, row.candidate_id));
  }
}
console.log(
  JSON.stringify(
    { imported: sites.length, sourceSha256: sha256(fs.readFileSync(path.resolve(file))), sites },
    null,
    2,
  ),
);
