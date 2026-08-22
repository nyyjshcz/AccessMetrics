"""Reproducible analysis for a verified AccessCheck export.

The script accepts only a materialized export directory. It never downloads a
site, invents a missing value, or turns a fixture into a formal conclusion.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import sys
import zlib
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path
from typing import Any

from reference_score import exact_score, half_up_tenths

ANALYSIS_VERSION = "accesscheck-analysis-v1"
SCENARIOS = {
    "A": ({"critical": 40, "serious": 30, "moderate": 20, "minor": 10}, 40),
    "B": ({"critical": 50, "serious": 30, "moderate": 20, "minor": 10}, 50),
    "C": ({"critical": 40, "serious": 25, "moderate": 15, "minor": 10}, 40),
}
PRINCIPLES = ("perceivable", "operable", "understandable", "robust")
IMPACTS = ("critical", "serious", "moderate", "minor")


def describe(values: list[float]) -> dict[str, Any]:
    ordered = sorted(values)
    if not ordered:
        return {"n": 0, "mean": None, "median": None, "q1": None, "q3": None, "min": None, "max": None}

    def percentile(fraction: float) -> float:
        position = (len(ordered) - 1) * fraction
        lower = int(position)
        upper = min(len(ordered) - 1, lower + 1)
        weight = position - lower
        return ordered[lower] * (1 - weight) + ordered[upper] * weight

    return {
        "n": len(ordered),
        "mean": sum(ordered) / len(ordered),
        "median": percentile(0.5),
        "q1": percentile(0.25),
        "q3": percentile(0.75),
        "min": ordered[0],
        "max": ordered[-1],
    }


def rank_values(values: list[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    index = 0
    while index < len(indexed):
        end = index
        while end + 1 < len(indexed) and indexed[end + 1][1] == indexed[index][1]:
            end += 1
        rank = (index + end + 2) / 2
        for cursor in range(index, end + 1):
            ranks[indexed[cursor][0]] = rank
        index = end + 1
    return ranks


def spearman(left: list[float], right: list[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None
    left_rank, right_rank = rank_values(left), rank_values(right)
    left_mean = sum(left_rank) / len(left_rank)
    right_mean = sum(right_rank) / len(right_rank)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left_rank, right_rank))
    denominator_left = sum((a - left_mean) ** 2 for a in left_rank)
    denominator_right = sum((b - right_mean) ** 2 for b in right_rank)
    denominator = (denominator_left * denominator_right) ** 0.5
    return numerator / denominator if denominator else None


def canonical(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
        + "\n"
    ).encode("utf-8")


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def verify_manifest(root: Path) -> tuple[dict[str, Any], str]:
    manifest_path = root / "manifest.json"
    checksum_path = root / "manifest.sha256"
    if not manifest_path.is_file() or not checksum_path.is_file():
        raise ValueError("verified export must contain manifest.json and manifest.sha256")
    manifest_bytes = manifest_path.read_bytes()
    digest = sha256(manifest_bytes)
    if checksum_path.read_text(encoding="utf-8").strip() != digest:
        raise ValueError("manifest.sha256 does not match manifest bytes")
    manifest = json.loads(manifest_bytes.decode("utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != "canonical-manifest-json-v1":
        raise ValueError("unsupported manifest schema")
    for item in manifest.get("files", []):
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("manifest file entry is invalid")
        relative = Path(item["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("manifest contains an unsafe path")
        payload = root / relative
        if not payload.is_file():
            raise ValueError(f"manifest payload is missing: {item['path']}")
        content = payload.read_bytes()
        if len(content) != item.get("size") or sha256(content) != item.get("sha256"):
            raise ValueError(f"manifest payload hash mismatch: {item['path']}")
    return manifest, digest


def scan_files(root: Path) -> list[Path]:
    files = sorted(root.rglob("scan.json"))
    if not files:
        raise ValueError("verified export contains no scan.json")
    return files


def parse_principles(issue: dict[str, Any]) -> list[str]:
    value = issue.get("principles", issue.get("principles_json", []))
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = []
    if not isinstance(value, list):
        value = []
    return [item for item in value if item in PRINCIPLES]


def nodes_for(issue: dict[str, Any]) -> list[dict[str, Any]]:
    raw = issue.get("raw")
    raw = raw if isinstance(raw, dict) else {}
    nodes = raw.get("nodes")
    if isinstance(nodes, list) and nodes:
        return [node if isinstance(node, dict) else {} for node in nodes]
    count = issue.get("node_count", issue.get("nodeCount", 0))
    try:
        count = max(0, int(count))
    except (TypeError, ValueError):
        count = 0
    return [{} for _ in range(count)]


def opportunities_from_scan(scan: dict[str, Any]) -> tuple[list[dict[str, Any]], Counter, Counter, set[str]]:
    opportunities: list[dict[str, Any]] = []
    severity = Counter()
    rules = Counter()
    pages: set[str] = set()
    for issue in scan.get("issues", []):
        if not isinstance(issue, dict):
            continue
        result_type = issue.get("result_type", issue.get("resultType"))
        page = str(issue.get("canonical_url", issue.get("canonicalUrl", "")))
        if page:
            pages.add(page)
        rule_id = str(issue.get("rule_id", issue.get("ruleId", "")))
        node_rows = nodes_for(issue)
        if result_type in ("violation", "incomplete"):
            rules[rule_id] += len(node_rows)
        scoring_eligible = issue.get("scoring_eligible", issue.get("scoringEligible", 1))
        if scoring_eligible in (0, False, "0", "false"):
            continue
        if result_type == "incomplete":
            continue
        if result_type not in ("pass", "violation"):
            continue
        principles = parse_principles(issue)
        for node in node_rows:
            impact = node.get("impact") or issue.get("impact")
            impact = impact if impact in IMPACTS else None
            if result_type == "violation":
                severity[impact or "unknown"] += 1
            opportunities.append(
                {
                    "passed": result_type == "pass",
                    "impact": impact,
                    "principles": principles,
                    "site_id": str(scan.get("run", {}).get("site_id", "unknown")),
                    "page": page,
                    "rule_id": rule_id,
                }
            )
    return opportunities, severity, rules, pages


def score_payload(value: Fraction | None) -> dict[str, Any] | None:
    if value is None:
        return None
    return {
        "exactNumerator": str(value.numerator),
        "exactDenominator": str(value.denominator),
        "exact": f"{value.numerator}/{value.denominator}",
        "display": half_up_tenths(value),
    }


def rank_scores(values: dict[str, Fraction]) -> dict[str, int]:
    ordered = sorted(values.items(), key=lambda item: (-item[1], item[0]))
    output: dict[str, int] = {}
    previous: Fraction | None = None
    rank = 0
    for index, (key, value) in enumerate(ordered, 1):
        if previous is None or value != previous:
            rank = index
            previous = value
        output[key] = rank
    return output


def run(source: dict[str, Any]) -> dict[str, Any]:
    """Analyze the small normalized fixture payload used by parity tests.

    Formal exports must use :func:`analyze_export`; this compatibility helper
    intentionally returns only fixture score/rank fields and has no authority
    to label them as research results.
    """
    site_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in source.get("opportunities", []):
        if isinstance(row, dict):
            site_rows[str(row.get("site_id", "fixture"))].append(row)
    scores = {
        site: value
        for site, value in ((site, exact_score(rows)) for site, rows in site_rows.items())
        if value is not None
    }
    return {
        "siteScores": {site: score_payload(value) for site, value in scores.items()},
        "rank": rank_scores(scores),
    }


def summarize_manual_validation(root: Path, population_size: int) -> dict[str, Any]:
    path = root / "manual-reviews.json"
    rows = read_json(path) if path.is_file() else []
    current: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        key = (str(row.get("result_node_id")), str(row.get("reviewer")))
        if row.get("is_current"):
            current[key] = row
    by_node: dict[str, dict[str, str]] = defaultdict(dict)
    for (node, reviewer), row in current.items():
        by_node[node][reviewer] = str(row.get("verdict", ""))
    pairs = [values for values in by_node.values() if len(values) >= 2]
    agreements = sum(1 for values in pairs if len(set(values.values())) == 1)
    disagreements = len(pairs) - agreements
    kappa: float | None = None
    kappa_reason: str | None = None
    if not pairs:
        kappa_reason = "no_complete_two_reviewer_pairs"
    else:
        labels = sorted({verdict for values in pairs for verdict in values.values()})
        n = len(pairs)
        observed = agreements / n
        expected = sum(
            sum(1 for values in pairs if values.get("computer_lead") == label)
            * sum(1 for values in pairs if values.get("math_lead") == label)
            for label in labels
        ) / (n * n)
        if expected == 1:
            kappa_reason = "all_pairs_have_one_verdict"
        else:
            kappa = (observed - expected) / (1 - expected)
    return {
        "populationSize": population_size,
        "targetSize": min(40, population_size),
        "samplerVersion": "manual-review-sampler-v1",
        "confirmedCount": sum(1 for row in current.values() if row.get("verdict") == "confirmed"),
        "notAnIssueCount": sum(1 for row in current.values() if row.get("verdict") == "not_an_issue"),
        "uncertainCount": sum(1 for row in current.values() if row.get("verdict") == "uncertain"),
        "agreementCount": agreements,
        "disagreementCount": disagreements,
        "agreementRate": agreements / len(pairs) if pairs else None,
        "kappa": kappa,
        "kappaNullReason": kappa_reason,
        "interpretationScope": "manual sample only; not axe accuracy or a citywide estimate",
    }


def write_chart(output_root: Path, site_scores: dict[str, Fraction]) -> list[dict[str, Any]]:
    chart_dir = output_root / "charts"
    table_dir = output_root / "tables"
    chart_dir.mkdir(parents=True, exist_ok=True)
    table_dir.mkdir(parents=True, exist_ok=True)
    table = {
        "schemaVersion": "analysis-table-v1",
        "rows": [
            {"site": site, **(score_payload(value) or {})}
            for site, value in sorted(site_scores.items(), key=lambda item: (-item[1], item[0]))
        ],
    }
    table_path = table_dir / "site-scores.json"
    table_path.write_bytes(canonical(table))
    chart_path = chart_dir / "site-scores.png"
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        labels = list(sorted(site_scores, key=lambda key: (-site_scores[key], key)))
        values = [float(half_up_tenths(site_scores[label]) or 0) for label in labels]
        figure, axis = plt.subplots(figsize=(8, max(2.5, 0.35 * max(1, len(labels)))))
        if labels:
            axis.barh(labels[::-1], values[::-1], color="#2f6f9f")
            axis.set_xlim(0, 100)
            axis.set_xlabel("Score (0–100)")
        else:
            axis.text(0.5, 0.5, "No eligible score", ha="center", va="center")
            axis.set_axis_off()
        axis.set_title("AccessCheck site scores")
        figure.tight_layout()
        figure.savefig(chart_path, dpi=140)
        plt.close(figure)
    except Exception:
        # Keep the analysis runnable in a minimal Python environment. This is
        # a real PNG with deterministic bars; matplotlib is still preferred
        # whenever the locked analysis environment is available.
        width, height = 640, max(120, 32 * max(1, len(site_scores)) + 40)
        pixels = bytearray(width * height * 3)
        for index, (site, value) in enumerate(
            sorted(site_scores.items(), key=lambda item: (-item[1], item[0]))
        ):
            del site
            y0 = 20 + index * 32
            bar_width = int(max(0, min(100, float(half_up_tenths(value) or 0))) * 5.5)
            for y in range(y0, min(height, y0 + 20)):
                for x in range(0, min(width, bar_width)):
                    offset = (y * width + x) * 3
                    pixels[offset : offset + 3] = b"/o\x9f"
        scanlines = b"".join(b"\x00" + pixels[y * width * 3 : (y + 1) * width * 3] for y in range(height))
        png = [b"\x89PNG\r\n\x1a\n"]
        def chunk(name: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)
        png.append(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)))
        png.append(chunk(b"IDAT", zlib.compress(scanlines, 9)))
        png.append(chunk(b"IEND", b""))
        chart_path.write_bytes(b"".join(png))
    return [
        {"path": "tables/site-scores.json", "sha256": sha256(table_path.read_bytes()), "kind": "data"},
        {"path": "charts/site-scores.png", "sha256": sha256(chart_path.read_bytes()), "kind": "png"},
    ]


def analyze_export(root: Path) -> dict[str, Any]:
    manifest, manifest_hash = verify_manifest(root)
    scans = [read_json(path) for path in scan_files(root)]
    site_categories: dict[str, str] = {}
    sites_csv = root / "data" / "sites.csv"
    if sites_csv.is_file():
        lines = sites_csv.read_text(encoding="utf-8-sig").splitlines()
        if lines:
            headers = lines[0].split(",")
            if "id" in headers and "category" in headers:
                id_index, category_index = headers.index("id"), headers.index("category")
                for line in lines[1:]:
                    cells = line.split(",")
                    if len(cells) > max(id_index, category_index) and cells[category_index]:
                        site_categories[cells[id_index]] = cells[category_index]
    site_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    severity = Counter()
    common_rules = Counter()
    page_urls: set[str] = set()
    statuses = Counter()
    frame = Counter()
    versions: set[tuple[str, str, str]] = set()
    population_items: list[dict[str, Any]] = []
    all_incomplete = 0
    all_violation = 0
    for scan in scans:
        run_info = scan.get("run", {}) if isinstance(scan, dict) else {}
        site = str(run_info.get("site_id") or run_info.get("origin") or "unknown")
        statuses[str(run_info.get("status") or "unknown")] += 1
        versions.add(
            (
                str(run_info.get("scanner_version") or "unknown"),
                str(run_info.get("axe_version") or "unknown"),
                str(run_info.get("score_model_version") or "accesscheck-score-v1"),
            )
        )
        opportunities, scan_severity, scan_rules, scan_pages = opportunities_from_scan(scan)
        for row in opportunities:
            row["site_id"] = site
        site_rows[site].extend(opportunities)
        severity.update(scan_severity)
        common_rules.update(scan_rules)
        page_urls.update(scan_pages)
        for issue in scan.get("issues", []):
            result_type = issue.get("result_type")
            if result_type in ("incomplete", "violation"):
                node_rows = nodes_for(issue)
                if result_type == "incomplete":
                    all_incomplete += len(node_rows)
                else:
                    all_violation += len(node_rows)
                for index, node in enumerate(node_rows):
                    population_items.append(
                        {
                            "site": site,
                            "page": issue.get("canonical_url"),
                            "rule": issue.get("rule_id"),
                            "resultType": result_type,
                            "ordinal": index,
                            "target": node.get("target"),
                        }
                    )
        pages = scan.get("pages")
        if isinstance(pages, list):
            for page in pages:
                if not isinstance(page, dict):
                    continue
                frame["frameTotal"] += int(page.get("frame_total") or page.get("frameTotal") or 0)
                frame["tested"] += int(page.get("frame_tested_total") or page.get("frameTestedTotal") or 0)
                frame["skipped"] += int(page.get("frame_skipped_total") or page.get("frameSkippedTotal") or 0)
                frame["errors"] += int(page.get("frame_error_count") or page.get("frameErrorCount") or 0)
                if page.get("frame_coverage_status") in ("limited", "coverage_limited") or page.get("frameCoverageStatus") == "limited":
                    frame["limitedPages"] += 1

    site_exact = {site: exact_score(rows) for site, rows in site_rows.items()}
    site_exact = {site: value for site, value in site_exact.items() if value is not None}
    all_rows = [row for rows in site_rows.values() for row in rows]
    four_principles: dict[str, dict[str, Any] | None] = {
        principle: score_payload(exact_score([row for row in all_rows if principle in row.get("principles", [])]))
        for principle in PRINCIPLES
    }
    sensitivity: dict[str, Any] = {}
    for name, (weights, maximum) in SCENARIOS.items():
        scenario_values = {site: exact_score(rows, weights, maximum) for site, rows in site_rows.items()}
        scenario_values = {site: value for site, value in scenario_values.items() if value is not None}
        sensitivity[name] = {
            "weights": weights,
            "maxWeight": maximum,
            "scores": {site: score_payload(value) for site, value in scenario_values.items()},
            "ranking": sorted(scenario_values, key=lambda site: (-scenario_values[site], site)),
            "rank": rank_scores(scenario_values),
        }
    score_displays = [float(half_up_tenths(value)) for value in site_exact.values() if half_up_tenths(value) is not None]
    category_scores: dict[str, list[float]] = defaultdict(list)
    for site, value in site_exact.items():
        if site_categories.get(site):
            category_scores[site_categories[site]].append(float(half_up_tenths(value) or 0))
    category_comparison = {
        category: {"siteCount": len(values), "scoreDistribution": describe(values)}
        for category, values in sorted(category_scores.items())
    }
    scenario_scores = {
        name: {
            site: float(value)
            for site, value in (
                (site, exact_score(site_rows[site], SCENARIOS[name][0], SCENARIOS[name][1]))
                for site in site_rows
            )
            if value is not None
        }
        for name in SCENARIOS
    }
    common_sites = sorted(set.intersection(*(set(values) for values in scenario_scores.values()))) if scenario_scores else []
    spearman_pairs = {}
    for left, right in (("A", "B"), ("A", "C"), ("B", "C")):
        if left not in scenario_scores or right not in scenario_scores:
            spearman_pairs[f"{left}_vs_{right}"] = None
            continue
        spearman_pairs[f"{left}_vs_{right}"] = spearman(
            [scenario_scores[left][site] for site in common_sites],
            [scenario_scores[right][site] for site in common_sites],
        )
    sensitivity["spearman"] = {
        "commonSiteCount": len(common_sites),
        "correlations": spearman_pairs,
        "nullReason": "fewer_than_two_common_sites_or_constant_ranks" if any(value is None for value in spearman_pairs.values()) else None,
    }
    computed_population_digest = sha256(canonical(sorted(population_items, key=lambda item: canonical(item))))
    manifest_population_digest = manifest.get("populationDigest")
    if manifest_population_digest is not None and (
        not isinstance(manifest_population_digest, str)
        or len(manifest_population_digest) != 64
        or any(character not in "0123456789abcdef" for character in manifest_population_digest)
    ):
        raise ValueError("manifest populationDigest is not a SHA-256")
    # Formal study exports carry the server-side population digest, which is
    # computed from stable result-node identities before export IDs/timestamps
    # exist. The report must preserve that frozen identity instead of replacing
    # it with an approximate digest reconstructed from rendered scan JSON.
    population_digest = manifest_population_digest or computed_population_digest
    metadata = {
        "exportId": manifest.get("exportId"),
        "sourceExportId": manifest.get("sourceExportId") or manifest.get("exportId"),
        "manifestHash": manifest_hash,
        "sourceManifestHash": manifest.get("sourceManifestHash") or manifest_hash,
        "studyFreezeId": manifest.get("studyFreezeId"),
        "populationDigest": population_digest,
        "outcomeDigest": manifest.get("outcomeDigest"),
        "reviewFreezeHash": manifest.get("reviewFreezeHash"),
        "modelDecisionHash": manifest.get("modelDecisionHash"),
        "modelObservationsHash": manifest.get("modelObservationsHash"),
        "r4EvidenceBundleHash": manifest.get("r4EvidenceBundleHash"),
        "scanTimeLocalizationHash": manifest.get("scanTimeLocalizationHash"),
        "reportLocalizationHash": manifest.get("reportLocalizationHash"),
        "generatedAt": manifest.get("generatedAt"),
        "provenance": {
            "analysisVersion": ANALYSIS_VERSION,
            "codeCommit": os.environ.get("APP_GIT_COMMIT"),
            "versions": sorted(
                [{"scannerVersion": a, "axeVersion": b, "modelVersion": c} for a, b, c in versions],
                key=lambda item: (item["scannerVersion"], item["axeVersion"], item["modelVersion"]),
            ),
            "calculationKeys": {
                "siteScores": "data/runs/*/scan.json:eligible pass/violation nodes grouped by site; exact_score; half_up_tenths",
                "severitySummary": "data/runs/*/scan.json:violation nodes grouped by effective impact",
                "manualValidation": "manual-reviews.json:current formal rows grouped by result node and reviewer",
                "sensitivity": "data/runs/*/scan.json:three fixed weight scenarios A/B/C; exact values before display rounding",
                "categoryComparison": "data/sites.csv:category joined to site score by sites.id",
                "spearman": "sensitivity A/B/C:common site IDs; average ranks for ties",
            },
        },
    }
    output: dict[str, Any] = {
        "schemaVersion": "report-data-v1",
        **metadata,
        "sampleSummary": {
            "populationSize": all_violation + all_incomplete,
            "targetSize": min(40, all_violation + all_incomplete),
            "siteCount": len(site_rows),
            "pageCount": len(page_urls),
            "runCount": len(scans),
            "successPageCount": len(page_urls),
        },
        "pageStatusSummary": {
            "runsByStatus": dict(statuses),
            "success": sum(statuses.get(status, 0) for status in ("completed", "completed_with_errors")),
            "failed": statuses.get("failed", 0),
            "partial": statuses.get("completed_with_errors", 0),
        },
        "frameCoverageSummary": {
            "frameTotal": frame["frameTotal"],
            "tested": frame["tested"],
            "skipped": frame["skipped"],
            "errors": frame["errors"],
            "limitedPages": frame["limitedPages"],
        },
        "scores": {
            "siteScores": {site: score_payload(value) for site, value in site_exact.items()},
            "rank": rank_scores(site_exact),
            "overall": score_payload(exact_score(all_rows)),
            "fourPrinciples": four_principles,
            "distribution": describe(score_displays),
            "categoryComparison": category_comparison,
        },
        "severitySummary": {key: severity[key] for key in sorted(severity)},
        "commonRules": [{"ruleId": rule, "count": count} for rule, count in common_rules.most_common()],
        "principleSummary": {
            principle: {
                "opportunityCount": sum(1 for row in all_rows if principle in row.get("principles", [])),
                "score": four_principles[principle],
            }
            for principle in PRINCIPLES
        },
        "sensitivity": sensitivity,
        "manualValidation": summarize_manual_validation(root, all_violation + all_incomplete),
        "charts": [],
        "limitations": [
            "自动评分仅覆盖 axe 可自动判断的机会，不等同于完整人工审计或官方合规认证。",
            "incomplete 结果保留并计入人工样本总体，但不进入自动分数分母。",
            "人工样本统计只解释实际抽样，不外推为 axe 总体准确率或全市估计。",
        ],
    }
    output_dir = Path(os.environ.get("ANALYSIS_OUTPUT_DIR", str(Path.cwd() / "analysis" / "outputs")))
    output["charts"] = write_chart(output_dir, site_exact)
    return output


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python analysis/analyze.py <verified-export-directory>")
    source = Path(sys.argv[1]).resolve()
    if not source.is_dir():
        raise SystemExit("verified export must be a directory")
    print(json.dumps(analyze_export(source), ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
