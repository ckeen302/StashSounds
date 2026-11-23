"""One handler in a child process with a wall-clock timeout and a memory cap."""

from __future__ import annotations

import time
import uuid
from pathlib import Path

import pytest

from stash_worker.jobs import Rejected
from stash_worker.sandbox import run_isolated

PAYLOAD = {"id": str(uuid.uuid4()), "itemId": str(uuid.uuid4()), "kind": "process_loop", "attempts": 1}
MiB = 1 << 20


def _alive(pid: int) -> bool:
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
    except FileNotFoundError:
        return False
    return state not in {"Z", "X"}


def run(handler: str, tmp_path: Path, timeout_s: float = 20, memory_bytes: int | None = 1024 * MiB):
    return run_isolated(f"handlers:{handler}", PAYLOAD, tmp_path, timeout_s=timeout_s, memory_bytes=memory_bytes)


def test_result_comes_back_from_the_child(tmp_path: Path):
    out = run("ok", tmp_path)
    assert out.status == "ok"
    assert out.result is not None and out.result["files"][0]["path"].startswith(PAYLOAD["itemId"] + "/")
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


def test_rejected_accepts_only_contract_reasons():
    Rejected("unsafe_archive")
    for bad in ("timeout", "internal", "not_a_reason"):
        with pytest.raises(ValueError):
            Rejected(bad)
