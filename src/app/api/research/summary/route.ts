import { NextResponse } from "next/server";
import { getDb, migrate } from "@/lib/db";
import { AppError, errorEnvelope } from "@/lib/errors";
import { buildRunScore } from "@/lib/run-score";

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], probability: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100;
}

function frozenPrinciples(value: string | null) {
  if (!value) return [] as string[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [] as string[];
  }
}

type ResearchRow = {
  id: string;
  name: string;
  origin: string;
  category: string | null;
  runId: string;
  status: string;
  scannerVersion: string;
  axeVersion: string;
  modelVersion: string;
  published: number;
};

function scoreDistribution(values: number[]) {
  const histogram = Array.from({ length: 10 }, (_, index) => ({
    label: `${index * 10}–${index === 9 ? 100 : index * 10 + 9}`,
    count: 0,
  }));
  for (const score of values) histogram[Math.min(9, Math.floor(score / 10))].count += 1;
  return {
    count: values.length,
    mean: round(
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    ),
    median: round(median(values)),
    q1: round(quantile(values, 0.25)),
    q3: round(quantile(values, 0.75)),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    histogram,
  };
}

export async function GET(request: Request) {
  try {
    migrate();
    const url = new URL(request.url);
    const category = url.searchParams.get("category");
    const scannerVersion = url.searchParams.get("scannerVersion");
    const axeVersion = url.searchParams.get("axeVersion");
    const modelVersion = url.searchParams.get("modelVersion");
    const supplied = [scannerVersion, axeVersion, modelVersion].filter(Boolean).length;
    if (supplied !== 0 && supplied !== 3)
      throw new AppError(
        "VERSION_SELECTION_REQUIRED",
        "scanner/axe/model 三个版本必须一起指定",
        409,
      );
    const versions = getDb()
      .prepare(
        "SELECT DISTINCT r.scanner_version scannerVersion,r.axe_version axeVersion,r.score_model_version modelVersion FROM scan_runs r JOIN scan_jobs j ON j.id=r.job_id WHERE r.status='completed' AND r.published=1 AND j.study_campaign_id IS NOT NULL AND COALESCE(r.scanner_version,'')<>'' AND COALESCE(r.axe_version,'')<>'' AND COALESCE(r.score_model_version,'')<>'' ORDER BY r.scanner_version,r.axe_version,r.score_model_version",
      )
      .all() as Array<{ scannerVersion: string; axeVersion: string; modelVersion: string }>;
    const ordinaryVersions = getDb()
      .prepare(
        "SELECT DISTINCT r.scanner_version scannerVersion,r.axe_version axeVersion,r.score_model_version modelVersion FROM scan_runs r JOIN scan_jobs j ON j.id=r.job_id WHERE r.status='completed' AND r.published=1 AND j.study_campaign_id IS NULL AND COALESCE(r.scanner_version,'')<>'' AND COALESCE(r.axe_version,'')<>'' AND COALESCE(r.score_model_version,'')<>'' ORDER BY r.scanner_version,r.axe_version,r.score_model_version",
      )
      .all() as Array<{ scannerVersion: string; axeVersion: string; modelVersion: string }>;
    const selected =
      supplied === 3
        ? { scannerVersion, axeVersion, modelVersion }
        : versions.length === 1
          ? versions[0]
          : null;
    if (!selected && versions.length > 1)
      throw new AppError("VERSION_SELECTION_REQUIRED", "存在多个版本三元组，请完整指定版本", 409, {
        options: versions,
      });
    const ordinarySelected =
      supplied === 3
        ? { scannerVersion, axeVersion, modelVersion }
        : (selected ?? (ordinaryVersions.length === 1 ? ordinaryVersions[0] : null));
    const clauses = selected
      ? [
          "r.status='completed'",
          "r.published=1",
          "j.study_campaign_id IS NOT NULL",
          "r.scanner_version=?",
          "r.axe_version=?",
          "r.score_model_version=?",
        ]
      : [];
    const args: unknown[] = selected
      ? [selected.scannerVersion, selected.axeVersion, selected.modelVersion]
      : [];
    if (category && selected) {
      clauses.push("s.category=?");
      args.push(category);
    }
    const rows = selected
      ? (getDb()
          .prepare(
            `SELECT s.id,s.name,s.origin,s.category,r.id runId,r.status,r.scanner_version scannerVersion,r.axe_version axeVersion,r.score_model_version modelVersion,r.published FROM scan_runs r JOIN scan_jobs j ON j.id=r.job_id JOIN sites s ON s.id=r.site_id WHERE ${clauses.join(" AND ")} ORDER BY s.name`,
          )
          .all(...args) as Array<{
          id: string;
          name: string;
          origin: string;
          category: string | null;
          runId: string;
          status: string;
          scannerVersion: string;
          axeVersion: string;
          modelVersion: string;
          published: number;
        }>)
      : [];
    const ordinaryClauses = ordinarySelected
      ? [
          "r.status='completed'",
          "r.published=1",
          "j.study_campaign_id IS NULL",
          "r.scanner_version=?",
          "r.axe_version=?",
          "r.score_model_version=?",
        ]
      : [];
    const ordinaryArgs: unknown[] = ordinarySelected
      ? [
          ordinarySelected.scannerVersion,
          ordinarySelected.axeVersion,
          ordinarySelected.modelVersion,
        ]
      : [];
    if (category && ordinarySelected) {
      ordinaryClauses.push("s.category=?");
      ordinaryArgs.push(category);
    }
    const ordinaryRows = ordinarySelected
      ? (getDb()
          .prepare(
            `SELECT s.id,s.name,s.origin,s.category,r.id runId,r.status,r.scanner_version scannerVersion,r.axe_version axeVersion,r.score_model_version modelVersion,r.published FROM scan_runs r JOIN scan_jobs j ON j.id=r.job_id JOIN sites s ON s.id=r.site_id WHERE ${ordinaryClauses.join(" AND ")} ORDER BY s.name`,
          )
          .all(...ordinaryArgs) as ResearchRow[])
      : [];
    const ordinaryItems = ordinaryRows
      .map((row) => {
        const score = buildRunScore(row.runId);
        return {
          ...row,
          overall: score.overall,
          perceivable: score.perceivable,
          operable: score.operable,
          understandable: score.understandable,
          robust: score.robust,
          incomplete: score.resultNodeCounts.incomplete,
        };
      })
      .sort((left, right) => {
        if (left.overall === null && right.overall !== null) return 1;
        if (left.overall !== null && right.overall === null) return -1;
        if (left.overall !== null && right.overall !== null && left.overall !== right.overall)
          return right.overall - left.overall;
        return left.name.localeCompare(right.name);
      });
    const ordinaryValues = ordinaryItems
      .map((item) => item.overall)
      .filter((value): value is number => typeof value === "number");
    const severity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    const principles = { perceivable: 0, operable: 0, understandable: 0, robust: 0 };
    const ruleCounts = new Map<string, number>();
    const enriched = rows.map((row) => {
      const score = buildRunScore(row.runId);
      const runSeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      const runPrinciples = { perceivable: 0, operable: 0, understandable: 0, robust: 0 };
      const runRules = getDb()
        .prepare(
          "SELECT result_type,impact,rule_id,principles_json,node_count FROM rule_results WHERE run_id=? AND result_type IN ('violation','incomplete') ORDER BY id",
        )
        .all(row.runId) as Array<{
        result_type: string;
        impact: string | null;
        rule_id: string;
        principles_json: string | null;
        node_count: number;
      }>;
      for (const result of runRules) {
        const count = Math.max(0, Number(result.node_count) || 0);
        if (result.result_type === "violation") {
          const impact = result.impact ?? "minor";
          if (impact in runSeverity) {
            runSeverity[impact as keyof typeof runSeverity] += count;
            severity[impact as keyof typeof severity] += count;
          }
        }
        for (const principle of frozenPrinciples(result.principles_json)) {
          if (principle in runPrinciples) {
            runPrinciples[principle as keyof typeof runPrinciples] += count;
            principles[principle as keyof typeof principles] += count;
          }
        }
        ruleCounts.set(result.rule_id, (ruleCounts.get(result.rule_id) ?? 0) + count);
      }
      return {
        ...row,
        overall: score.overall,
        perceivable: score.perceivable,
        operable: score.operable,
        understandable: score.understandable,
        robust: score.robust,
        incomplete: score.resultNodeCounts.incomplete,
        severity: runSeverity,
        principles: runPrinciples,
      };
    });
    enriched.sort((left, right) => {
      if (left.overall === null && right.overall !== null) return 1;
      if (left.overall !== null && right.overall === null) return -1;
      if (left.overall !== null && right.overall !== null && left.overall !== right.overall)
        return right.overall - left.overall;
      return left.name.localeCompare(right.name);
    });
    const overallValues = enriched
      .map((item) => item.overall)
      .filter((value): value is number => typeof value === "number");
    const histogram = Array.from({ length: 10 }, (_, index) => ({
      label: `${index * 10}–${index === 9 ? 100 : index * 10 + 9}`,
      count: 0,
    }));
    for (const score of overallValues) histogram[Math.min(9, Math.floor(score / 10))].count += 1;
    const categoryGroups = new Map<string, { count: number; values: number[] }>();
    for (const item of enriched) {
      const key = item.category ?? "未分类";
      const group = categoryGroups.get(key) ?? { count: 0, values: [] };
      group.count += 1;
      if (item.overall !== null) group.values.push(item.overall);
      categoryGroups.set(key, group);
    }
    const categorySummary = [...categoryGroups.entries()].sort(([a], [b]) => a.localeCompare(b));
    return NextResponse.json({
      baseline: selected,
      items: enriched,
      options: versions,
      summary: {
        distribution: {
          count: overallValues.length,
          mean: round(
            overallValues.length
              ? overallValues.reduce((sum, value) => sum + value, 0) / overallValues.length
              : null,
          ),
          median: round(median(overallValues)),
          q1: round(quantile(overallValues, 0.25)),
          q3: round(quantile(overallValues, 0.75)),
          min: overallValues.length ? Math.min(...overallValues) : null,
          max: overallValues.length ? Math.max(...overallValues) : null,
          histogram,
        },
        severity,
        principles,
        incomplete: enriched.reduce((sum, item) => sum + item.incomplete, 0),
        commonRules: [...ruleCounts.entries()]
          .sort(([ruleA, countA], [ruleB, countB]) => countB - countA || ruleA.localeCompare(ruleB))
          .slice(0, 10)
          .map(([ruleId, nodeCount]) => ({ ruleId, nodeCount })),
        categories: categorySummary.map(([name, group]) => ({
          name,
          count: group.count,
          mean: round(
            group.values.length
              ? group.values.reduce((sum, value) => sum + value, 0) / group.values.length
              : null,
          ),
          median: round(median(group.values)),
        })),
      },
      ordinary: {
        baseline: ordinarySelected,
        options: ordinaryVersions,
        items: ordinaryItems,
        summary: ordinarySelected ? { distribution: scoreDistribution(ordinaryValues) } : null,
        note: "普通已发布 run 仅供日常查看，不计入正式研究总体。",
      },
      note: "仅正式 study campaign 的已发布 run 进入研究汇总；普通发布 run 保留在日常结果页，不混入研究总体",
    });
  } catch (error) {
    return NextResponse.json(errorEnvelope(error), {
      status: error instanceof AppError ? error.status : 500,
    });
  }
}
