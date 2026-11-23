"""One handler in a child process with a wall-clock timeout and a memory cap."""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path

import pytest

from stash_worker.jobs import Rejected
from stash_worker.sandbox import CHILD_FILE_BYTES, CHILD_PROCESSES, _uid_task_count, run_isolated

PAYLOAD = {"id": str(uuid.uuid4()), "itemId": str(uuid.uuid4()), "kind": "process_loop", "attempts": 1}
MiB = 1 << 20


def _alive(pid: int) -> bool:
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
    except FileNotFoundError:
        return False
    return state not in {"Z", "X"}


INPUT = {"jobId": PAYLOAD["id"], "attempt": 1, "itemId": PAYLOAD["itemId"], "files": []}


def run(handler: str, tmp_path: Path, timeout_s: float = 20, memory_bytes: int = 1024 * MiB):
    return run_isolated(f"handlers:{handler}", PAYLOAD, INPUT, tmp_path, timeout_s=timeout_s, memory_bytes=memory_bytes)


def test_result_comes_back_from_the_child(tmp_path: Path):
    out = run("ok", tmp_path)
    assert out.status == "ok"
    assert out.result is not None and out.result["type"] == "loop"
    assert (tmp_path / "work" / "scratch.bin").read_bytes() == b"temporary"


def test_timeout_kills_the_child_and_its_grandchildren(tmp_path: Path):
    started = time.monotonic()
    out = run("sleep_with_grandchild", tmp_path, timeout_s=1.5)
    assert out.status == "timeout"
    assert time.monotonic() - started < 10
    pid = int((tmp_path / "work" / "grandchild.pid").read_text())
    deadline = time.monotonic() + 5
    while _alive(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not _alive(pid), "the grandchild survived the timeout"


def test_memory_cap_stops_a_runaway_handler(tmp_path: Path):
    out = run("hog_memory", tmp_path, memory_bytes=512 * MiB)
    assert out.status == "crashed"
    assert "MemoryError" in out.detail


def test_a_hard_crash_is_reported(tmp_path: Path):
    out = run("crash", tmp_path)
    assert out.status == "crashed"
    assert "exit 3" in out.detail


def test_an_exception_is_reported_with_its_type(tmp_path: Path):
    out = run("raise_error", tmp_path)
    assert out.status == "crashed"
    assert "RuntimeError: boom" in out.detail


def test_a_rejection_carries_its_reason(tmp_path: Path):
    out = run("reject_corrupt", tmp_path)
    assert (out.status, out.reason, out.detail) == ("rejected", "corrupt_file", "bad header")


def test_an_unknown_handler_is_a_crash(tmp_path: Path):
    out = run("does_not_exist", tmp_path)
    assert out.status == "crashed"


def test_rejected_accepts_only_file_fault_reasons():
    for good in ("corrupt_file", "unsupported_format", "unsafe_archive", "too_long", "silent", "no_notes"):
        Rejected(good)
    # Runner reasons describe the run; screening matches come back as result.flag, never as a failure.
    for bad in (
        "timeout",
        "internal",
        "duplicate_exact",
        "duplicate_fingerprint",
        "commercial_match",
        "pack_name_blocklist",
        "not_a_reason",
    ):
        with pytest.raises(ValueError):
            Rejected(bad)


def test_a_screening_match_raised_as_a_rejection_is_a_crash(tmp_path: Path):
    assert run("reject_as_flag", tmp_path).status == "crashed"


def test_the_child_sees_only_an_allowlisted_environment(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://secret@db/x")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "secret")
    monkeypatch.setenv("STASH_S3_SECRET_ACCESS_KEY", "secret")
    assert run("env_probe", tmp_path).status == "ok"
    env = json.loads((tmp_path / "work" / "probe.json").read_text())["env"]
    assert "secret" not in json.dumps(env)
    # LC_CTYPE may be added by the child interpreter itself (PEP 538 locale coercion), not passed in.
    assert set(env) <= {"PATH", "PYTHONPATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "HOME"}
    assert Path(env["HOME"]).is_relative_to(tmp_path) and Path(env["TMPDIR"]).is_relative_to(tmp_path)


def test_the_child_runs_under_resource_limits(tmp_path: Path):
    run("env_probe", tmp_path, memory_bytes=768 * MiB)
    got = json.loads((tmp_path / "work" / "probe.json").read_text())["limits"]
    assert got["RLIMIT_AS"] == 768 * MiB
    assert got["RLIMIT_CORE"] == 0
    assert got["RLIMIT_FSIZE"] == CHILD_FILE_BYTES
    # RLIMIT_NPROC counts every task of the uid, so the cap is what the uid runs now plus the allowance.
    now = _uid_task_count()
    assert now is not None
    assert CHILD_PROCESSES < got["RLIMIT_NPROC"] <= now + CHILD_PROCESSES + 50


def test_the_process_allowance_counts_threads_not_just_processes():
    # The kernel checks RLIMIT_NPROC against every task (thread) of the real uid. Counting processes
    # left a uid running a many-threaded process (the GitHub runner agent) already over the cap, so
    # the child could not start ffmpeg or any grandchild. Holding 100 threads must raise the count by 100.
    before = _uid_task_count()
    stop = threading.Event()
    threads = [threading.Thread(target=stop.wait) for _ in range(100)]
    for t in threads:
        t.start()
    try:
        during = _uid_task_count()
    finally:
        stop.set()
        for t in threads:
            t.join()
    assert before is not None and during is not None
    assert during - before >= 100


def test_a_grandchild_starts_while_the_worker_uid_runs_many_threads(tmp_path: Path):
    # The CI failure in one test: under a non-root uid with a threaded process, the cap must still
    # leave room for the job's own tools. (Root ignores RLIMIT_NPROC, so this bites only as non-root.)
    stop = threading.Event()
    threads = [threading.Thread(target=stop.wait) for _ in range(200)]
    for t in threads:
        t.start()
    try:
        out = run("sleep_with_grandchild", tmp_path, timeout_s=1.5)
    finally:
        stop.set()
        for t in threads:
            t.join()
    assert out.status == "timeout", out.detail
    assert (tmp_path / "work" / "grandchild.pid").exists()


@pytest.mark.parametrize("handler", ["forge_runner_reason", "forge_flag_reason", "forge_garbage", "forge_list_result"])
def test_a_forged_outcome_is_a_crash(tmp_path: Path, handler: str):
    out = run(handler, tmp_path)
    assert (out.status, out.result, out.reason) == ("crashed", None, None)


def test_an_outcome_over_the_size_cap_is_not_read(tmp_path: Path):
    out = run("forge_huge_outcome", tmp_path)
    assert out.status == "crashed"
    assert "too large" in out.detail
