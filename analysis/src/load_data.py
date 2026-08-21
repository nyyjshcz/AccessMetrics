"""Load a canonical study export without changing its bytes."""
from __future__ import annotations
import json
from pathlib import Path

def load_json(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))
