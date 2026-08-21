"""Small deterministic notebook runner used when nbconvert is unavailable.

The project notebook contains ordinary Python cells only.  This runner executes
those cells in one namespace, captures stdout, and writes a valid executed
notebook without inventing inputs.  Production environments may prefer the
Jupyter nbconvert path; this fallback keeps local verification reproducible.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
from pathlib import Path


def execute(source: Path, destination: Path) -> None:
    notebook = json.loads(source.read_text(encoding="utf-8"))
    namespace: dict[str, object] = {"__name__": "__notebook__"}
    execution_count = 0
    for cell in notebook.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        execution_count += 1
        stdout = io.StringIO()
        stderr = io.StringIO()
        source_text = "".join(cell.get("source", []))
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            exec(compile(source_text, str(source), "exec"), namespace)
        outputs = []
        if stdout.getvalue():
            outputs.append({"output_type": "stream", "name": "stdout", "text": stdout.getvalue()})
        if stderr.getvalue():
            outputs.append({"output_type": "stream", "name": "stderr", "text": stderr.getvalue()})
        cell["execution_count"] = execution_count
        cell["outputs"] = outputs
    notebook["metadata"].setdefault("accesscheck", {})["runner"] = "stdlib-notebook-runner-v1"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: python execute_notebook.py <source.ipynb> <executed.ipynb>")
    execute(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
