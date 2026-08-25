from pathlib import Path
from tempfile import TemporaryDirectory
import json
import sys
import hashlib
import os
import shutil
import subprocess

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analysis"))
from reference_score import exact_score, half_up_tenths
from analyze import analyze_export

root = Path(__file__).resolve().parents[1]
repository_root = root
source_notebook = json.loads(
    (repository_root / "analysis" / "notebooks" / "accesscheck_analysis.ipynb").read_text(
        encoding="utf-8"
    )
)
assert all(
    not cell.get("outputs") and cell.get("execution_count") is None
    for cell in source_notebook["cells"]
    if cell.get("cell_type") == "code"
), "source notebook must remain clean"
golden = root / "analysis" / "golden"
if not golden.exists():
    print("analysis golden directory not present yet; analysis tests are pending")
    raise SystemExit(0)
for path in sorted(golden.glob("*.json")):
    fixture = json.loads(path.read_text(encoding="utf-8"))
    actual = half_up_tenths(exact_score(fixture["opportunities"]))
    if actual != fixture["expected"]["overall"]:
        raise SystemExit(f"analysis parity failed for {path.name}: {actual} != {fixture['expected']['overall']}")
tie = half_up_tenths(exact_score([{"passed": True}] * 39 + [{"passed": False, "impact": "minor"}]))
if tie is None:
    raise SystemExit("half-up fixture unexpectedly returned N/A")
null_impact = half_up_tenths(
    exact_score([{"passed": False, "result_type": "violation", "impact": None}])
)
if null_impact != 75.0:
    raise SystemExit(f"null-impact violation parity failed: {null_impact}")
print("analysis fixtures and Python reference scoring passed")

# Exercise the same export-boundary checks used by ``analysis:run`` without
# placing fixture data in the formal research directories.
with TemporaryDirectory(prefix="accesscheck-analysis-") as temporary:
    root = Path(temporary)
    scan = {
        "schemaVersion": "scan-export-v1",
        "exportId": "fixture-export",
        "run": {
            "site_id": "fixture-site",
            "status": "completed",
            "scanner_version": "accesscheck-scanner-v1",
            "axe_version": "4.13.0",
            "score_model_version": "accesscheck-score-v1",
        },
        "score": {},
        "issues": [
            {
                "canonical_url": "https://fixture.example/",
                "rule_id": "image-alt",
                "result_type": "pass",
                "impact": None,
                "node_count": 1,
                "principles_json": '["perceivable"]',
                "raw": {"nodes": [{}]},
            },
            {
                "canonical_url": "https://fixture.example/",
                "rule_id": "button-name",
                "result_type": "violation",
                "impact": "serious",
                "node_count": 1,
                "principles_json": '["operable"]',
                "raw": {"nodes": [{}]},
            },
        ],
    }
    scan_bytes = (json.dumps(scan, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()
    (root / "scan.json").write_bytes(scan_bytes)
    manifest = {
        "schemaVersion": "canonical-manifest-json-v1",
        "exportId": "fixture-export",
        "generatedAt": "2026-01-01T00:00:00.000Z",
        "files": [{"path": "scan.json", "size": len(scan_bytes), "sha256": hashlib.sha256(scan_bytes).hexdigest()}],
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()
    (root / "manifest.json").write_bytes(manifest_bytes)
    (root / "manifest.sha256").write_text(hashlib.sha256(manifest_bytes).hexdigest() + "\n", encoding="utf-8")
    previous_output = os.environ.get("ANALYSIS_OUTPUT_DIR")
    os.environ["ANALYSIS_OUTPUT_DIR"] = str(root / "analysis-output")
    result = analyze_export(root)
    if previous_output is None:
        os.environ.pop("ANALYSIS_OUTPUT_DIR", None)
    else:
        os.environ["ANALYSIS_OUTPUT_DIR"] = previous_output
    required = {
        "schemaVersion", "exportId", "manifestHash", "sourceExportId", "sourceManifestHash",
        "studyFreezeId", "populationDigest", "outcomeDigest", "reviewFreezeHash",
        "modelDecisionHash", "modelObservationsHash", "r4EvidenceBundleHash",
        "scanTimeLocalizationHash", "reportLocalizationHash", "generatedAt", "provenance",
        "sampleSummary", "pageStatusSummary", "frameCoverageSummary", "scores",
        "severitySummary", "commonRules", "principleSummary", "sensitivity",
        "manualValidation", "charts", "limitations",
    }
    assert required.issubset(result), sorted(required - result.keys())
    assert result["schemaVersion"] == "report-data-v1"
    assert result["scores"]["siteScores"]["fixture-site"]["display"] == 62.5
    assert {item["kind"] for item in result["charts"]} == {"data", "png"}
    node = shutil.which("node")
    if not node:
        raise SystemExit("analysis:run verification requires node")
    tsx = repository_root / "node_modules" / "tsx" / "dist" / "cli.mjs"
    completed = subprocess.run(
        [node, str(tsx), str(repository_root / "scripts" / "analysis-run.ts"), str(root.resolve())],
        cwd=repository_root,
        env={**os.environ, "CI": "true"},
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise SystemExit(completed.stderr or completed.stdout)
    executed_path = repository_root / "analysis" / "outputs" / "accesscheck_analysis.executed.ipynb"
    executed = json.loads(executed_path.read_text(encoding="utf-8"))
    code_cells = [cell for cell in executed["cells"] if cell.get("cell_type") == "code"]
    assert code_cells and all(isinstance(cell.get("execution_count"), int) for cell in code_cells)
print("verified export analysis pipeline and chart/table artifacts passed")
