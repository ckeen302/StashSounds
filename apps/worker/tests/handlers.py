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


def forge_linked_outcome(ctx: JobContext) -> dict[str, Any]:
    """A valid outcome with a second hard link, which the parent must not read."""
    report = ctx.workdir.parent / "report"
    (report / "outcome.json").write_text(json.dumps({"status": "ok", "result": loop_result(ctx.payload["itemId"])}))
    os.link(report / "outcome.json", ctx.workdir / "linked.json")
    os._exit(0)


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


def escape_with_setsid(ctx: JobContext) -> dict[str, Any]:
    """Double-forks a process into its own session, out of the job's process group, as a compromised
    handler could, and returns at once. The survivor writes its pid and sleeps."""
    pid_file = ctx.workdir / "escaped.pid"
    if os.fork() == 0:
        os.setsid()
        if os.fork() == 0:
            pid_file.write_text(str(os.getpid()))
            time.sleep(300)
        os._exit(0)
    for _ in range(500):
        if pid_file.exists() and pid_file.read_text():
            break
        time.sleep(0.01)
    return loop_result(ctx.payload["itemId"])


def count_my_uid(ctx: JobContext) -> dict[str, Any]:
    """Lists processes of this uid other than this one, which must be none."""
    me, others = os.getpid(), []
    for entry in os.listdir("/proc"):
        if entry.isdigit() and int(entry) != me:
            try:
                if os.stat(f"/proc/{entry}").st_uid == os.getuid():
                    others.append(int(entry))
            except OSError:
                pass
    (ctx.workdir / "probe.json").write_text(json.dumps({"others": others}))
    return loop_result(ctx.payload["itemId"])


def seccomp_probe(ctx: JobContext) -> dict[str, Any]:
    """Tries what the child's seccomp filter refuses (syscall_probe.py), and what it must still allow."""
    import ctypes
    import errno
    import platform

    from syscall_probe import probe

    from stash_worker.seccomp import ARCHES

    libc = ctypes.CDLL(None, use_errno=True)
    nr = ARCHES[platform.machine()].syscalls

    def errno_of(r: int) -> str:
        return "ok" if r >= 0 else errno.errorcode.get(ctypes.get_errno(), str(ctypes.get_errno()))

    facts: dict[str, Any] = {}
    try:
        os.unshare(0x10000000)  # CLONE_NEWUSER
        facts["unshare_user"] = "ok"
    except OSError as e:
        facts["unshare_user"] = errno.errorcode[e.errno]
    facts.update(probe())
    ctypes.set_errno(0)
    facts["clone3"] = errno_of(libc.syscall(nr["clone3"], None, 0))
    ctypes.set_errno(0)
    facts["ptrace"] = errno_of(libc.syscall(nr["ptrace"], 0, 0, 0, 0))  # PTRACE_TRACEME
    status = dict(line.split(":", 1) for line in open("/proc/self/status") if ":" in line)  # noqa: PTH123
    facts["no_new_privs"] = status["NoNewPrivs"].strip()
    facts["seccomp"] = status["Seccomp"].strip()
    # Ordinary process starts must still work: Python's subprocess, and a thread (clone3 falls back).
    import threading

    t = threading.Thread(target=lambda: None)
    t.start()
    t.join()
    facts["ffmpeg"] = subprocess.run(["ffmpeg", "-version"], capture_output=True, check=False).returncode  # noqa: S607
    (ctx.workdir / "probe.json").write_text(json.dumps(facts))
    return loop_result(ctx.payload["itemId"])


def network_probe(ctx: JobContext) -> dict[str, Any]:
    import socket

    facts: dict[str, Any] = {"interfaces": [name for _, name in socket.if_nameindex()]}
    try:
        with socket.create_connection(("127.0.0.1", ctx.input["port"]), timeout=2):
            facts["connect"] = "connected"
    except OSError as e:
        facts["connect"] = type(e).__name__
    (ctx.workdir / "probe.json").write_text(json.dumps(facts))
    return loop_result(ctx.payload["itemId"])


def hold_threads(ctx: JobContext) -> dict[str, Any]:
    """Holds 40 threads (within the 64-task cap and 1 GiB of 8 MB stacks) until the parent has counted
    them and removed work/hold."""
    import threading

    stop = threading.Event()
    threads = [threading.Thread(target=stop.wait) for _ in range(40)]
    for t in threads:
        t.start()
    (ctx.workdir / "holding").write_text("1")
    for _ in range(2000):
        if not (ctx.workdir / "hold").exists():
            break
        time.sleep(0.005)
    stop.set()
    for t in threads:
        t.join()
    return loop_result(ctx.payload["itemId"])
