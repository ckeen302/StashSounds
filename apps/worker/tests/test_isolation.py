"""The child runs as a separate unprivileged uid (ticket 112, PR #3 review): it cannot read a file only
the worker can read, cannot read the worker's environment through /proc, and cannot signal the worker.

Starting a process as another uid needs root (or CAP_SETUID), which the worker image has. These tests
skip when the suite is not root, unless STASH_REQUIRE_ISOLATION=1 makes that a failure. The job user
is STASH_TEST_JOB_USER (default: nobody).
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

from stash_worker.runner import Runner
from stash_worker.sandbox import JobUser, run_isolated
from stash_worker.storage import LocalStorage

PAYLOAD = {"id": str(uuid.uuid4()), "itemId": str(uuid.uuid4()), "kind": "process_loop", "attempts": 1}


@pytest.fixture
def job_user() -> JobUser:
    if os.geteuid() != 0:
        if os.environ.get("STASH_REQUIRE_ISOLATION") == "1":
            pytest.fail("STASH_REQUIRE_ISOLATION=1 but the tests are not running as root")
        pytest.skip("starting the child as another uid needs root")
    return JobUser.lookup(os.environ.get("STASH_TEST_JOB_USER", "nobody"))


@pytest.fixture
def job_root() -> Iterator[Path]:
    """A folder the job user can pass through (pytest's own tmp folders are 0700 to root)."""
    root = Path(tempfile.mkdtemp(prefix="stash-isolation-"))
    root.chmod(0o711)
    yield root
    shutil.rmtree(root, ignore_errors=True)


@pytest.fixture
def secret(job_root: Path) -> Path:
    """A file only the worker's uid can read, like .env.local or a mounted key."""
    p = job_root / "worker-only.txt"
    p.write_text("DATABASE_URL=postgres://secret")
    p.chmod(0o600)
    return p


def run_as(job_user: JobUser, job_root: Path, handler: str, extra_input: dict) -> tuple[str, dict]:
    job_dir = Path(tempfile.mkdtemp(dir=job_root))
    out = run_isolated(
        f"handlers:{handler}",
        PAYLOAD,
        {"jobId": PAYLOAD["id"], **extra_input},
        job_dir,
        timeout_s=20,
        memory_bytes=1 << 30,
        job_user=job_user,
    )
    probe = job_dir / "work" / "probe.json"
    return out.status, (json.loads(probe.read_text()) if probe.exists() else {"detail": out.detail})


def test_the_child_runs_as_the_job_user(job_user: JobUser, job_root: Path):
    status, probe = run_as(job_user, job_root, "isolation_probe", {})
    assert status == "ok", probe
    assert (probe["uid"], probe["euid"], probe["gid"]) == (job_user.uid, job_user.uid, job_user.gid)
    assert probe["groups"] in ([], [job_user.gid])
    assert probe["uid"] != os.getuid()


def test_the_child_cannot_read_a_worker_only_file(job_user: JobUser, job_root: Path, secret: Path):
    assert secret.read_text().startswith("DATABASE_URL")  # the worker can
    status, probe = run_as(job_user, job_root, "isolation_probe", {"secretPath": str(secret)})
    assert status == "ok", probe
    assert probe["secret"] == "PermissionError"


def test_the_child_cannot_read_the_workers_environment_or_signal_it(job_user: JobUser, job_root: Path):
    status, probe = run_as(job_user, job_root, "isolation_probe", {"workerPid": os.getpid()})
    assert status == "ok", probe
    assert probe["environ"] == "PermissionError"
    assert probe["signal"] == "PermissionError"


def test_the_job_folder_belongs_to_the_job_user_and_the_parent_still_reads_the_outcome(
    job_user: JobUser, job_root: Path
):
    job_dir = Path(tempfile.mkdtemp(dir=job_root))
    out = run_isolated(
        "handlers:ok", PAYLOAD, {"jobId": PAYLOAD["id"]}, job_dir, timeout_s=20, memory_bytes=1 << 30, job_user=job_user
    )
    assert out.status == "ok"
    st = (job_dir / "work").stat()
    assert (st.st_uid, stat.S_IMODE(st.st_mode)) == (job_user.uid, 0o700)
    assert (job_dir / "work" / "scratch.bin").stat().st_uid == job_user.uid


def test_a_timeout_still_kills_a_child_running_as_the_job_user(job_user: JobUser, job_root: Path):
    job_dir = Path(tempfile.mkdtemp(dir=job_root))
    out = run_isolated(
        "handlers:sleep_with_grandchild",
        PAYLOAD,
        {"jobId": PAYLOAD["id"]},
        job_dir,
        timeout_s=1.5,
        memory_bytes=1 << 30,
        job_user=job_user,
    )
    assert out.status == "timeout", out.detail


def test_the_runner_passes_the_job_user_and_removes_the_folder(job_user: JobUser, job_root: Path, monkeypatch):
    from test_runner import FakeQueue, job

    j = job()
    q = FakeQueue([j], LocalStorage(job_root / "store"))
    r = Runner(
        q,
        storage=q.storage,
        handlers={"process_loop": "handlers:isolation_probe_result"},
        temp_root=job_root,
        sleep=lambda s: None,
        job_user=job_user,
    )
    r.run_once()
    [(call, _, _, result)] = q.outcomes()
    assert call == "complete"
    assert result["files"][0]["meta"]["uid"] == job_user.uid
    assert [p.name for p in job_root.iterdir()] == ["store"]
