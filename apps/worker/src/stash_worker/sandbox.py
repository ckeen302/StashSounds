"""Runs one handler in a child process with a wall-clock timeout and a memory cap, so a hostile file
cannot stall or exhaust the worker (build spec: Worker jobs, common step 3).

The child is a fresh Python interpreter in its own process group. Its address space is capped with
RLIMIT_AS before it starts, and tools it spawns (ffmpeg, fpcalc) inherit the cap. On timeout, or once
it exits, the whole group is killed, so no grandchild outlives the job.
"""

from __future__ import annotations

import json
import os
import resource
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

Status = Literal["ok", "rejected", "timeout", "crashed"]


@dataclass(frozen=True)
class Outcome:
    status: Status
    result: dict[str, Any] | None = None
    reason: str | None = None
    detail: str = ""


def _limit(memory_bytes: int | None):
    def apply() -> None:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if memory_bytes is not None:
            resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))

    return apply


def _kill_group(pgid: int) -> None:
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_isolated(
    handler: str,
    payload: dict[str, Any],
    job_dir: Path,
    *,
    timeout_s: float,
    memory_bytes: int | None,
) -> Outcome:
    """Runs `handler` ("module:function") on `payload` with `job_dir/work` as its folder.
    `job_dir` must exist; the caller deletes it."""
    (job_dir / "work").mkdir(exist_ok=True)
    (job_dir / "request.json").write_text(json.dumps({"handler": handler, "payload": payload}))
    proc = subprocess.Popen(  # noqa: S603 - fixed interpreter and module, no shell
        [sys.executable, "-m", "stash_worker.child", str(job_dir)],
        cwd=job_dir / "work",
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        preexec_fn=_limit(memory_bytes),  # noqa: PLW1509 - the worker is single-threaded
    )
    try:
        code = proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        _kill_group(proc.pid)
        proc.wait()
        return Outcome("timeout", detail=f"no result after {timeout_s:g} s")
    finally:
        _kill_group(proc.pid)

    try:
        outcome = json.loads((job_dir / "outcome.json").read_text())
    except (OSError, ValueError):
        how = f"signal {-code}" if code < 0 else f"exit {code}"
        return Outcome("crashed", detail=f"child ended with {how} and no outcome")
    if outcome.get("status") == "ok" and isinstance(outcome.get("result"), dict):
        return Outcome("ok", result=outcome["result"])
    if outcome.get("status") == "rejected":
        return Outcome("rejected", reason=outcome["reason"], detail=outcome.get("detail") or "")
    return Outcome("crashed", detail=str(outcome.get("detail", "no result")))
