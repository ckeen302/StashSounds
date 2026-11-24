"""One handler in a child process with a wall-clock timeout and a memory cap."""

from __future__ import annotations

import json
import os
import platform
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import pytest

import stash_worker.sandbox as sandbox
from stash_worker.jobs import Rejected
from stash_worker.sandbox import CHILD_FILE_BYTES, CHILD_PROCESSES, _uid_task_count, run_isolated
from stash_worker.seccomp import Filter, Unsupported

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


def test_the_child_runs_under_resource_limits(tmp_path: Path, monkeypatch):
    # RLIMIT_NPROC counts every task of the uid, so the cap is what the uid runs at the start plus the
    # allowance. The count is pinned here because other processes of the same uid (a shared CI host, or
    # root on a dev box) start and stop between the child's start and this assertion; the real count is
    # covered by the thread-counting test below.
    assert _uid_task_count() is not None
    monkeypatch.setattr(sandbox, "_uid_task_count", lambda uid=None: 123)
    run("env_probe", tmp_path, memory_bytes=768 * MiB)
    got = json.loads((tmp_path / "work" / "probe.json").read_text())["limits"]
    assert got["RLIMIT_AS"] == 768 * MiB
    assert got["RLIMIT_CORE"] == 0
    assert got["RLIMIT_FSIZE"] == CHILD_FILE_BYTES
    assert got["RLIMIT_NPROC"] == 123 + CHILD_PROCESSES


def test_the_task_count_adds_up_every_thread_of_the_uids_processes(tmp_path: Path):
    # A /proc laid out by hand: two processes of this uid with 3 and 1 tasks, and names that are not pids.
    for pid, tasks in (("123", 3), ("456", 1)):
        for t in range(tasks):
            (tmp_path / pid / "task" / str(t)).mkdir(parents=True)
    (tmp_path / "self" / "task" / "1").mkdir(parents=True)
    (tmp_path / "sys").mkdir()
    assert _uid_task_count(os.getuid(), proc=tmp_path) == 4
    assert _uid_task_count(os.getuid() + 1, proc=tmp_path) == 0
    assert _uid_task_count(proc=tmp_path / "missing") is None


def test_the_process_allowance_counts_threads_not_just_processes():
    # The kernel checks RLIMIT_NPROC against every task (thread) of the real uid. Counting processes
    # left a uid running a many-threaded process (the GitHub runner agent) already over the cap, so
    # the child could not start ffmpeg or any grandchild. Holding 100 threads must raise the count by 100.
    if os.geteuid() == 0:
        # Root's count moves with every other root process; as root this is measured on the job uid,
        # which runs nothing else (test_isolation.py::test_the_job_uid_task_count_counts_its_threads).
        pytest.skip("measured on the job uid as root")
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


@pytest.mark.parametrize(
    "handler",
    ["forge_runner_reason", "forge_flag_reason", "forge_garbage", "forge_list_result", "forge_linked_outcome"],
)
def test_a_forged_outcome_is_a_crash(tmp_path: Path, handler: str):
    out = run(handler, tmp_path)
    assert (out.status, out.result, out.reason) == ("crashed", None, None)


def test_an_outcome_over_the_size_cap_is_not_read(tmp_path: Path):
    out = run("forge_huge_outcome", tmp_path)
    assert out.status == "crashed"
    assert "too large" in out.detail


# -- the child's seccomp filter (PR #8 re-review N1, A1) -------------------------------------------------

linux_only = pytest.mark.skipif(sys.platform != "linux", reason="seccomp is Linux only")

SECCOMP_EXPECTED = {
    "unshare_user": "EPERM",
    "mount": "EPERM",
    "clone_newns": "EPERM",
    "clone3": "ENOSYS",
    "bpf": "EPERM",
    "ptrace": "EPERM",
    "no_new_privs": "1",
    "seccomp": "2",
    "ffmpeg": 0,
}


@linux_only
def test_the_child_runs_under_no_new_privs_and_the_seccomp_filter(tmp_path: Path):
    assert run("seccomp_probe", tmp_path).status == "ok"
    assert json.loads((tmp_path / "work" / "probe.json").read_text()) == SECCOMP_EXPECTED


@linux_only
def test_the_filter_kills_a_process_on_a_foreign_architecture():
    other = "aarch64" if platform.machine() == "x86_64" else "x86_64"
    p = subprocess.run(  # noqa: S603
        [sys.executable, "-I", "-S", "-c", "pass"],
        preexec_fn=Filter(other).install,  # noqa: PLW1509
        check=False,
    )
    assert p.returncode == -signal.SIGSYS


def test_there_is_no_filter_for_an_unknown_architecture():
    with pytest.raises(Unsupported):
        Filter("riscv64")


@linux_only
def test_a_filter_is_available_here():
    assert sandbox.syscall_filter_available()
