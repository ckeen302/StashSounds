"""Job handlers used only by the tests. The sandbox imports them in a child process by "handlers:<name>",
which works because conftest.py puts this folder on PYTHONPATH."""

from __future__ import annotations

import os
import subprocess
import time
import uuid
from typing import Any

from stash_worker.jobs import JobContext, Rejected


def loop_result(item_id: str) -> dict[str, Any]:
    """A valid loop result whose derived files sit under the item's previews folder."""
    return {
        "type": "loop",
        "bpm": 140,
        "key": {"root": 9, "mode": "minor"},
        "durationMs": 6857,
        "details": {
            "sampleRate": 44100,
            "channels": 2,
            "loudnessLufs": -14,
            "truePeakDb": -1,
            "loopSamples": 302400,
            "bars": 4,
            "detection": {
                "bpmSource": "onset",
                "bpmAgreed": True,
                "bpmCandidates": [140],
                "keySource": "chroma",
                "keyConfidence": 0.3,
            },
        },
        "files": [
            {
                "role": "preview",
                "bucket": "previews",
                "path": f"{item_id}/abc.mp3",
                "bytes": 120000,
                "mime": "audio/mpeg",
                "sha256": None,
                "meta": {},
            }
        ],
        "fingerprints": [],
        "flag": None,
    }


def ok(ctx: JobContext) -> dict[str, Any]:
    (ctx.workdir / "scratch.bin").write_bytes(b"temporary")
    return loop_result(ctx.payload["itemId"])


def outside_folder(ctx: JobContext) -> dict[str, Any]:
    return loop_result(str(uuid.uuid4()))


def sleep_with_grandchild(ctx: JobContext) -> dict[str, Any]:
    """Starts a grandchild (as ffmpeg would be) and hangs, so a timeout must kill the whole group."""
    p = subprocess.Popen(["sleep", "300"])  # noqa: S607 - test helper
    (ctx.workdir / "grandchild.pid").write_text(str(p.pid))
    time.sleep(300)
    return {}


def crash(ctx: JobContext) -> dict[str, Any]:
    os._exit(3)


def raise_error(ctx: JobContext) -> dict[str, Any]:
    raise RuntimeError("boom")


def reject_corrupt(ctx: JobContext) -> dict[str, Any]:
    raise Rejected("corrupt_file", "bad header")


def reject_unsupported(ctx: JobContext) -> dict[str, Any]:
    raise Rejected("unsupported_format")


def hog_memory(ctx: JobContext) -> dict[str, Any]:
    chunks = []
    for _ in range(64):
        chunks.append(bytearray(64 << 20))  # 64 MiB at a time, 4 GiB in all
    return {"n": len(chunks)}


def invalid_result(ctx: JobContext) -> dict[str, Any]:
    return {"type": "loop", "bpm": 9999}


def wrong_type_result(ctx: JobContext) -> dict[str, Any]:
    return {**loop_result(ctx.payload["itemId"]), "type": "oneshot", "details": {"nope": True}}
