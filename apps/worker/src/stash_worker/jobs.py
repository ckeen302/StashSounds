"""What a job handler is, how it reports bad input, and which handler runs each job kind.

A handler is a plain function `(JobContext) -> dict` that returns a worker result
(contracts: workerResultSchema). It runs in a child process (sandbox.py) and is named by
"module:function" so the child can import it.

The child never touches storage or the database. Before it starts, the parent downloads each input
file to `workdir/in/<file id>` (`ctx.input_path`). The handler writes every derived file it reports to
`workdir/out/<bucket>/<path>` (`ctx.output_path`), and the parent uploads exactly those, after checking
them against the result.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from stash_worker.contracts import limits, worker_reasons

# job kind -> "module:function". Each ticket registers its processor here.
HANDLERS: dict[str, str] = {
    "process_loop": "stash_worker.audio.loop:process_loop",
}

# job kind -> the item type whose job it is (contracts: JOB_KIND_FOR_TYPE, plus the Vital render).
ITEM_TYPE_FOR_KIND = {
    "process_loop": "loop",
    "process_oneshot": "oneshot",
    "process_kit": "kit",
    "process_midi": "midi",
    "process_preset": "preset",
    "render_vital": "preset",
}

# job kind -> key of limits.json worker.timeoutsSeconds. Preset processing runs the audio steps on
# the uploader's demo; the Vital render is its own job (render_vital) with its own limit.
TIMEOUT_KEYS = {
    "process_loop": "audio",
    "process_oneshot": "audio",
    "process_kit": "kit",
    "process_midi": "midi",
    "process_preset": "audio",
    "render_vital": "presetRender",
}

# Reasons only the runner gives: they describe the run, not the file.
RUNNER_REASONS = frozenset({"timeout", "internal"})

# Screening matches. They are not failures: a handler returns them as result.flag, and
# worker_complete makes the item flagged (visible to its owner and admins) instead of ready.
FLAG_REASONS = frozenset({"duplicate_exact", "duplicate_fingerprint", "commercial_match", "pack_name_blocklist"})


def rejection_reasons() -> frozenset[str]:
    """Reasons a handler may fail a job with: the file itself is at fault."""
    return worker_reasons() - RUNNER_REASONS - FLAG_REASONS


def timeout_for(kind: str) -> float:
    return float(limits()["worker"]["timeoutsSeconds"][TIMEOUT_KEYS[kind]])


@dataclass(frozen=True)
class JobContext:
    payload: dict[str, Any]  # contracts: jobPayloadSchema
    input: dict[str, Any]  # contracts: workerJobInputSchema (item, owner, the uploaded files)
    workdir: Path  # this job's temporary folder, deleted when the job ends

    def input_path(self, file: dict[str, Any]) -> Path:
        """Where the parent put one of `input.files`."""
        return self.workdir / "in" / file["id"]

    def output_path(self, bucket: str, path: str) -> Path:
        """Where to write a derived file the result reports at `bucket`/`path`. Creates its folder."""
        p = self.workdir / "out" / bucket / path
        p.parent.mkdir(parents=True, exist_ok=True)
        return p


class Rejected(Exception):  # noqa: N818 - a rejection is an outcome, not a worker error
    """Raised by a handler when the file itself is bad (corrupt, unsupported, over a limit, hostile).
    The job fails once, without retry, and the item returns to draft with this reason.
    Only file-fault reasons are accepted; a screening match goes in result.flag instead."""

    def __init__(self, reason: str, detail: str | None = None):
        if reason not in rejection_reasons():
            raise ValueError(f"not a file rejection reason: {reason!r}")
        super().__init__(reason if detail is None else f"{reason}: {detail}")
        self.reason = reason
        self.detail = detail
