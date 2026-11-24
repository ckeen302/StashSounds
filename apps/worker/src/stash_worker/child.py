"""The child side of sandbox.py: `python -m stash_worker.child <job_dir>`.

Reads <job_dir>/request.json ({handler, payload, input}), runs the handler with <job_dir>/work as its
folder, and writes <job_dir>/report/outcome.json. Kept free of heavy imports so the memory cap goes to the
handler. The parent treats outcome.json as untrusted.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path
from typing import Any


def _write(job_dir: Path, outcome: dict[str, Any]) -> None:
    report = job_dir / "report"
    tmp = report / "outcome.json.tmp"
    tmp.write_text(json.dumps(outcome))
    os.replace(tmp, report / "outcome.json")


def main(argv: list[str]) -> int:
    job_dir = Path(argv[1])
    request = json.loads((job_dir / "request.json").read_text())
    from stash_worker.jobs import JobContext, Rejected

    try:
        module_name, func_name = request["handler"].split(":", 1)
        handler = getattr(importlib.import_module(module_name), func_name)
        ctx = JobContext(payload=request["payload"], input=request["input"], workdir=job_dir / "work")
        result = handler(ctx)
        _write(job_dir, {"status": "ok", "result": result})
        return 0
    except Rejected as e:
        _write(job_dir, {"status": "rejected", "reason": e.reason, "detail": e.detail})
        return 0
    except BaseException as e:  # noqa: BLE001 - every failure, MemoryError included, is reported
        _write(job_dir, {"status": "error", "detail": f"{type(e).__name__}: {e}"[:500]})
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
