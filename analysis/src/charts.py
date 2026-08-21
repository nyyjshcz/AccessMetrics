"""Chart data helpers; rendering is intentionally deterministic and optional."""
from __future__ import annotations

def score_series(scores: dict[str, dict]) -> list[dict]:
    return [{"site": site, **value} for site, value in sorted(scores.items())]
