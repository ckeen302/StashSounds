"""What a job handler is, how it reports bad input, and which handler runs each job kind.

A handler is a plain function `(JobContext) -> dict` that returns a worker result
(contracts: workerResultSchema). It runs in a child process (sandbox.py) and is named by
"module:function" so the child can import it. Processors arrive in tickets 112+.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from stash_worker.contracts import limits, worker_reasons

# job kind -> "module:function". Tickets 112+ register their processors here.
HANDLERS: dict[str, str] = {}

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


def timeout_for(kind: str) -> float:
    return float(limits()["worker"]["timeoutsSeconds"][TIMEOUT_KEYS[kind]])


@dataclass(frozen=True)
class JobContext:
    payload: dict[str, Any]  # contracts: jobPayloadSchema
    workdir: Path  # this job's temporary folder, deleted when the job ends


class Rejected(Exception):  # noqa: N818 - a rejection is an outcome, not a worker error
    """Raised by a handler when the file itself is bad (corrupt, unsupported, over a limit, hostile).
    The job fails once, without retry, and the item returns to draft with this reason."""

    def __init__(self, reason: str, detail: str | None = None):
        if reason not in worker_reasons() or reason in RUNNER_REASONS:
            raise ValueError(f"not a file rejection reason: {reason!r}")
        super().__init__(reason if detail is None else f"{reason}: {detail}")
        self.reason = reason
        self.detail = detail
