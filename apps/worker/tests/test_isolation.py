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
import socket
import stat
import subprocess
import tempfile
import threading
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

import stash_worker.sandbox as sandbox
from stash_worker.contracts import REPO_ROOT
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
    assert probe["secret"] == "PermissionError"  # noqa: S105 - an exception name, not a password


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


@pytest.mark.parametrize("allowance", [sandbox.CHILD_PROCESSES, 8])
def test_the_loop_processor_runs_as_the_job_user_within_its_limits(
    job_user: JobUser, job_root: Path, monkeypatch, allowance: int
):
    # ffmpeg's threads count toward RLIMIT_NPROC for the job uid, which a root child never hits. Left to
    # itself ffmpeg starts threads per core (12 for a FLAC decode on 4 cores), so a big machine would
    # exceed the allowance; the worker pins ffmpeg to one thread per step, which fits in 8.
    from test_runner import FakeQueue, job, job_input

    monkeypatch.setattr(sandbox, "CHILD_PROCESSES", allowance)

    fixture = REPO_ROOT / "fixtures/generated/loops/drill_lead_142.flac"
    j = job()
    store = LocalStorage(job_root / "store")
    q = FakeQueue([j], store)
    data = job_input(j)
    f = data["files"][0]
    f["bytes"] = fixture.stat().st_size
    store.upload("originals", f["path"], fixture, "audio/flac", None)
    q.input_override = data
    r = Runner(q, storage=store, temp_root=job_root, sleep=lambda s: None, job_user=job_user)
    r.run_once()
    [(call, _, _, result)] = q.outcomes()
    assert call == "complete", q.outcomes()
    assert result["details"]["loopSamples"] == 149070


# -- PR #8 review: survivors, the process cap, groups, network ------------------------------------------


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return Path(f"/proc/{pid}/stat").exists() and ") Z " not in Path(f"/proc/{pid}/stat").read_text()


def test_a_child_that_escapes_with_setsid_does_not_outlive_its_job(job_user: JobUser, job_root: Path):
    status, _ = run_as(job_user, job_root, "escape_with_setsid", {})
    assert status == "ok"
    [escaped] = [int(p.read_text()) for p in job_root.glob("*/work/escaped.pid")]
    assert not _alive(escaped)
    assert sandbox._uid_task_count(job_user.uid) == 0
    # And the next job starts with no other process of the job uid.
    status, probe = run_as(job_user, job_root, "count_my_uid", {})
    assert status == "ok", probe
    assert probe["others"] == []


def test_a_survivor_left_from_before_is_killed_before_the_next_job(job_user: JobUser, job_root: Path):
    # A job-uid process the worker did not start (a crash between jobs, an older worker) is gone too.
    survivor = subprocess.Popen(  # noqa: S603
        ["sleep", "300"],  # noqa: S607
        user=job_user.uid,
        group=job_user.gid,
        extra_groups=[],
        start_new_session=True,
    )
    try:
        status, probe = run_as(job_user, job_root, "count_my_uid", {})
        assert status == "ok", probe
        assert probe["others"] == []
        survivor.wait(timeout=5)  # killed, and reaped by the worker (its subreaper), so 0 here
        assert not _alive(survivor.pid)
    finally:
        survivor.kill()


def test_the_process_cap_is_fixed_for_the_job_user(job_user: JobUser, job_root: Path, monkeypatch):
    # With survivors gone the job uid runs nothing else, so the cap is the allowance itself, whatever
    # the count would say.
    monkeypatch.setattr(sandbox, "_uid_task_count", lambda uid=None: 0 if uid == job_user.uid else 10_000)
    status, probe = run_as(job_user, job_root, "env_probe", {})
    assert status == "ok", probe
    assert probe["limits"]["RLIMIT_NPROC"] == sandbox.CHILD_PROCESSES


def test_the_child_drops_the_parents_supplementary_groups(job_user: JobUser, job_root: Path):
    before = os.getgroups()
    os.setgroups([*before, 4242])
    try:
        status, probe = run_as(job_user, job_root, "isolation_probe", {})
    finally:
        os.setgroups(before)
    assert status == "ok", probe
    assert probe["groups"] in ([], [job_user.gid])


def test_the_job_uid_task_count_counts_its_threads(job_user: JobUser, job_root: Path):
    # Stable as root: the job uid runs only this child, which holds exactly 40 threads beside its own.
    job_dir = Path(tempfile.mkdtemp(dir=job_root))
    (job_dir / "work").mkdir()
    (job_dir / "work" / "hold").write_text("1")
    done: list = []
    t = threading.Thread(
        target=lambda: done.append(
            run_isolated(
                "handlers:hold_threads",
                PAYLOAD,
                {"jobId": PAYLOAD["id"]},
                job_dir,
                timeout_s=20,
                memory_bytes=1 << 33,  # glibc reserves a 64 MB malloc arena per thread
                job_user=job_user,
            )
        )
    )
    t.start()
    try:
        for _ in range(1000):
            if (job_dir / "work" / "holding").exists():
                break
            time.sleep(0.01)
        assert sandbox._uid_task_count(job_user.uid) == 41
    finally:
        (job_dir / "work" / "hold").unlink(missing_ok=True)
        t.join()
    assert done[0].status == "ok"


@pytest.fixture
def listener() -> Iterator[int]:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen()
    yield s.getsockname()[1]
    s.close()


def test_the_child_has_no_network(job_user: JobUser, job_root: Path, listener: int):
    if not sandbox.network_isolation_available():
        pytest.fail("no CAP_SYS_ADMIN for a network namespace (decision 0017)")
    status, probe = run_as(job_user, job_root, "network_probe", {"port": listener})
    assert status == "ok", probe
    assert probe["connect"] != "connected"
    assert probe["interfaces"] == ["lo"]  # down, and nothing else


def test_the_network_probe_connects_when_isolation_is_off(job_user: JobUser, job_root: Path, listener: int):
    # Shows the probe above would see a working network: the same child with isolation off connects.
    job_dir = Path(tempfile.mkdtemp(dir=job_root))
    out = run_isolated(
        "handlers:network_probe",
        PAYLOAD,
        {"jobId": PAYLOAD["id"], "port": listener},
        job_dir,
        timeout_s=20,
        memory_bytes=1 << 30,
        job_user=job_user,
        isolate_network=False,
    )
    assert out.status == "ok"
    assert json.loads((job_dir / "work" / "probe.json").read_text())["connect"] == "connected"


def test_prepare_never_follows_a_link_planted_in_the_job_folder(job_user: JobUser, job_root: Path, secret: Path):
    job_dir = Path(tempfile.mkdtemp(dir=job_root))
    (job_dir / "work" / "in").mkdir(parents=True)
    (job_dir / "work" / "in" / "link").symlink_to(secret)
    (job_dir / "request.json").write_text("{}")
    sandbox._prepare(job_dir, job_user)
    assert secret.stat().st_uid == os.getuid()
    assert (job_dir / "work" / "in").stat().st_uid == job_user.uid
    assert (job_dir / "work" / "in" / "link").lstat().st_uid == job_user.uid
