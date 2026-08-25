from __future__ import annotations
from fractions import Fraction
from typing import Iterable
import json
from pathlib import Path

_CONFIG = json.loads(
    (Path(__file__).resolve().parents[1] / "scoring" / "scoring-config.v1.json").read_text(
        encoding="utf-8"
    )
)
_SCALE = int(_CONFIG.get("impactWeightScale", 10))
WEIGHTS = {key: int(value) * _SCALE for key, value in _CONFIG["impactWeights"].items()}
MAX_WEIGHT = int(_CONFIG.get("maximumImpactWeight", 4)) * _SCALE


def _impact(item: dict):
    impact = item.get("impact")
    if item.get("result_type", item.get("resultType")) == "violation" and not impact:
        return "minor"
    return impact

def exact_score(opportunities: Iterable[dict], weights=WEIGHTS, max_weight=MAX_WEIGHT):
    rows = list(opportunities)
    judged = [item for item in rows if item.get("passed") or _impact(item)]
    if not judged:
        return None
    failed = sum(0 if item.get("passed") else weights[_impact(item) or "minor"] for item in judged)
    denominator = max_weight * len(judged)
    numerator = 100 * (denominator - failed)
    if not 0 <= numerator <= 100 * denominator:
        raise ValueError("score bounds violated")
    return Fraction(numerator, denominator)

def half_up_tenths(value):
    if value is None:
        return None
    scaled = (2 * value.numerator * 10 + value.denominator) // (2 * value.denominator)
    return scaled / 10

if __name__ == "__main__":
    import json, sys
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    print(json.dumps({"overall": half_up_tenths(exact_score(data["opportunities"]))}, ensure_ascii=False))
