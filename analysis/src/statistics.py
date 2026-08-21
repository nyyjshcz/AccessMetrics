from __future__ import annotations
from statistics import mean, median

def describe(values: list[float]) -> dict[str, float | None]:
    return {"n": len(values), "mean": mean(values) if values else None, "median": median(values) if values else None}
