"""Job handlers used only by the tests. The sandbox imports them in a child process by "handlers:<name>",
which works because conftest.py puts this folder on PYTHONPATH."""

from __future__ import annotations

import hashlib
import json
import os
import resource
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
        "files": [],
        "fingerprints": [],
        "flag": None,
    }


def ok(ctx: JobContext) -> dict[str, Any]:
    (ctx.workdir / "scratch.bin").write_bytes(b"temporary")
    return loop_result(ctx.payload["itemId"])


def outside_folder(ctx: JobContext) -> dict[str, Any]:
    other = str(uuid.uuid4())
    data = b"ID3 elsewhere"
    digest = hashlib.sha256(data).hexdigest()
    path = f"{other}/{digest[:32]}.mp3"
    ctx.output_path("previews", path).write_bytes(data)
    result = loop_result(ctx.payload["itemId"])
    result["files"] = [_file(path, data, digest, {})]
    return result


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


def echo_input(ctx: JobContext) -> dict[str, Any]:
    return _preview(ctx, b"ID3 echo", b"ID3 echo", {"input": ctx.input})


def env_probe(ctx: JobContext) -> dict[str, Any]:
    probe = {
        "env": dict(os.environ),
        "limits": {
            name: resource.getrlimit(getattr(resource, name))[0]
            for name in ("RLIMIT_AS", "RLIMIT_FSIZE", "RLIMIT_NPROC", "RLIMIT_CORE")
        },
    }
    (ctx.workdir / "probe.json").write_text(json.dumps(probe))
    return loop_result(ctx.payload["itemId"])


def _forge(ctx: JobContext, text: str) -> dict[str, Any]:
    """Writes outcome.json itself and exits, as a compromised handler could."""
    (ctx.workdir.parent / "report" / "outcome.json").write_text(text)
    os._exit(0)


def forge_runner_reason(ctx: JobContext) -> dict[str, Any]:
    return _forge(ctx, '{"status": "rejected", "reason": "internal", "detail": ""}')


def forge_flag_reason(ctx: JobContext) -> dict[str, Any]:
    return _forge(ctx, '{"status": "rejected", "reason": "duplicate_exact"}')


def forge_garbage(ctx: JobContext) -> dict[str, Any]:
    return _forge(ctx, "{not json")


def forge_list_result(ctx: JobContext) -> dict[str, Any]:
    return _forge(ctx, '{"status": "ok", "result": [1, 2]}')


def forge_huge_outcome(ctx: JobContext) -> dict[str, Any]:
    result = loop_result(ctx.payload["itemId"])
    result["pad"] = "x" * (2 << 20)
    return _forge(ctx, json.dumps({"status": "ok", "result": result}))


def reject_as_flag(ctx: JobContext) -> dict[str, Any]:
    raise Rejected("duplicate_exact")


def read_original(ctx: JobContext) -> dict[str, Any]:
    [f] = ctx.input["files"]
    return _preview(ctx, b"ID3 read", b"ID3 read", {"original": ctx.input_path(f).read_text()})


def _file(path: str, data: bytes, digest: str, meta: dict[str, Any]) -> dict[str, Any]:
    return {
        "role": "preview",
        "bucket": "previews",
        "path": path,
        "bytes": len(data),
        "mime": "audio/mpeg",
        "sha256": digest,
        "meta": meta,
    }


def _preview(ctx: JobContext, data: bytes, claimed: bytes, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    """A result with one preview written where the parent publishes it from."""
    digest = hashlib.sha256(claimed).hexdigest()
    path = f"{ctx.payload['itemId']}/{digest[:32]}.mp3"
    ctx.output_path("previews", path).write_bytes(data)
    result = loop_result(ctx.payload["itemId"])
    result["files"] = [_file(path, data, digest, meta or {})]
    return result


def writes_preview(ctx: JobContext) -> dict[str, Any]:
    return _preview(ctx, b"ID3 fake preview", b"ID3 fake preview")


def writes_preview_wrong_hash(ctx: JobContext) -> dict[str, Any]:
    return _preview(ctx, b"ID3 fake preview", b"something else!")


def _isolation_facts(ctx: JobContext) -> dict[str, Any]:
    facts: dict[str, Any] = {"uid": os.getuid(), "euid": os.geteuid(), "gid": os.getgid(), "groups": os.getgroups()}
    if "secretPath" in ctx.input:
        try:
            facts["secret"] = open(ctx.input["secretPath"]).read()  # noqa: PTH123
        except OSError as e:
            facts["secret"] = type(e).__name__
    if "workerPid" in ctx.input:
        pid = ctx.input["workerPid"]
        try:
            facts["environ"] = open(f"/proc/{pid}/environ", "rb").read().decode(errors="replace")  # noqa: PTH123
        except OSError as e:
            facts["environ"] = type(e).__name__
        try:
            os.kill(pid, 0)
            facts["signal"] = "allowed"
        except OSError as e:
            facts["signal"] = type(e).__name__
    return facts


def isolation_probe(ctx: JobContext) -> dict[str, Any]:
    (ctx.workdir / "probe.json").write_text(json.dumps(_isolation_facts(ctx)))
    return loop_result(ctx.payload["itemId"])


def isolation_probe_result(ctx: JobContext) -> dict[str, Any]:
    return _preview(ctx, b"ID3 probe", b"ID3 probe", _isolation_facts(ctx))
