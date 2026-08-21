from __future__ import annotations
from fractions import Fraction
from typing import Iterable

WEIGHTS = {"critical": 40, "serious": 30, "moderate": 20, "minor": 10}

def exact_score(opportunities: Iterable[dict], weights=WEIGHTS, max_weight=40):
    judged = [item for item in opportunities if item.get("passed") or item.get("impact")]
    if not judged:
        return None
    failed = sum(0 if item.get("passed") else weights[item.get("impact", "minor")] for item in judged)
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
