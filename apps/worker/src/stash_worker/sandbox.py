"""Runs one handler in a child process with a wall-clock timeout and resource limits, so a hostile
file cannot stall or exhaust the worker (build spec: Worker jobs, common step 3).

The child is a fresh Python interpreter in its own process group, with:
- an allowlisted environment (no DATABASE_URL, no service or storage keys), HOME and TMPDIR inside
  the job folder;
- RLIMIT_AS (memory), RLIMIT_FSIZE (largest file it may write), RLIMIT_NPROC (processes it may add)
  and no core dumps, set before exec and inherited by the tools it spawns (ffmpeg, fpcalc).
On timeout, or once it exits, the whole group is killed, so no grandchild outlives the job.

With a JobUser (ticket 112), the child also runs as that separate unprivileged uid: it cannot read
files only the worker can read, the worker's /proc entries (its environment), or signal the worker.
The job folder stays the worker's; only work/, home/, tmp/ and report/ inside it are the child's.

The child reports through <job_dir>/report/outcome.json, which is read as untrusted input: opened
without following links, size-capped, shape-checked, and anything unexpected counts as a crash.
"""

from __future__ import annotations

import json
import logging
import os
import pwd
import resource
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from stash_worker.contracts import limits
from stash_worker.jobs import rejection_reasons
from stash_worker.safefs import UnsafePath, open_beneath

log = logging.getLogger(__name__)

Status = Literal["ok", "rejected", "timeout", "crashed"]

# Largest file a job may write: an unpacked kit is the biggest thing a job ever holds.
CHILD_FILE_BYTES = int(limits()["kit"]["maxUnpackedBytes"])
# Processes (tasks) a job may start on top of what its uid already runs. The kernel checks RLIMIT_NPROC
# against every task of the real uid, threads included, so the cap is the uid's task count plus this.
CHILD_PROCESSES = 64
# Largest outcome.json the parent will read. Results are metadata and paths, never audio.
OUTCOME_MAX_BYTES = 1 << 20
DETAIL_MAX = 500
ENV_PASSTHROUGH = ("PATH", "PYTHONPATH", "LANG", "LC_ALL")
# numpy's OpenBLAS (and any OpenMP code) starts a thread per core on import. Threads count toward
# RLIMIT_NPROC for the job uid, and a job is one small file, so the child gets one.
ENV_FIXED = {"OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"}
CHILD_DIRS = ("work", "home", "tmp", "report")


@dataclass(frozen=True)
class Outcome:
    status: Status
    result: dict[str, Any] | None = None
    reason: str | None = None
    detail: str = ""


def _uid_task_count(uid: int | None = None) -> int | None:
    """Tasks (threads of every process) owned by this uid, from /proc (Linux), which is what the
    kernel counts for RLIMIT_NPROC. Counting processes instead undercounts a uid that runs a threaded
    service (a CI agent, a desktop session) and leaves the child unable to fork. None without /proc."""
    proc = Path("/proc")
    if not proc.is_dir():
        return None
    uid, n = (os.getuid() if uid is None else uid), 0
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid == uid:
                n += len(os.listdir(entry / "task"))
        except OSError:
            continue  # the process ended while we looked
    return n


def _limit(memory_bytes: int, nproc: int | None):
    def apply() -> None:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (CHILD_FILE_BYTES, CHILD_FILE_BYTES))
        if sys.platform == "linux":
            resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
        if nproc is not None:
            resource.setrlimit(resource.RLIMIT_NPROC, (nproc, nproc))

    return apply


def _child_env(job_dir: Path) -> dict[str, str]:
    env = {k: os.environ[k] for k in ENV_PASSTHROUGH if k in os.environ}
    env["HOME"] = str(job_dir / "home")
    env["TMPDIR"] = str(job_dir / "tmp")
    env.update(ENV_FIXED)
    return env


def _kill_group(pgid: int) -> None:
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _read_outcome(job_dir: Path) -> dict[str, Any] | str:
    """The parsed report/outcome.json, or a string saying why it could not be used."""
    try:
        fd = open_beneath(job_dir, ["report", "outcome.json"])
    except UnsafePath as e:
        return f"no usable outcome ({e})"
    with os.fdopen(fd, "rb") as f:
        st = os.fstat(f.fileno())
        if st.st_size > OUTCOME_MAX_BYTES:
            return f"outcome too large ({st.st_size} bytes)"
        data = f.read(OUTCOME_MAX_BYTES + 1)
    if len(data) > OUTCOME_MAX_BYTES:
        return "outcome too large"
    try:
        outcome = json.loads(data)
    except ValueError:
        return "outcome is not JSON"
    return outcome if isinstance(outcome, dict) else "outcome is not an object"


def _interpret(outcome: dict[str, Any]) -> Outcome:
    status = outcome.get("status")
    if status == "ok":
        result = outcome.get("result")
        if isinstance(result, dict):
            return Outcome("ok", result=result)
        return Outcome("crashed", detail="result is not an object")
    if status == "rejected":
        reason, detail = outcome.get("reason"), outcome.get("detail")
        if reason not in rejection_reasons():
            return Outcome("crashed", detail=f"not a rejection reason: {str(reason)[:50]!r}")
        if detail is not None and not isinstance(detail, str):
            return Outcome("crashed", detail="rejection detail is not text")
        return Outcome("rejected", reason=reason, detail=(detail or "")[:DETAIL_MAX])
    if status == "error":
        return Outcome("crashed", detail=str(outcome.get("detail", ""))[:DETAIL_MAX])
    return Outcome("crashed", detail="unknown outcome status")


@dataclass(frozen=True)
class JobUser:
    """The unprivileged uid and gid a job's child runs as."""

    uid: int
    gid: int

    @classmethod
    def lookup(cls, name_or_uid: str) -> JobUser:
        entry = pwd.getpwuid(int(name_or_uid)) if name_or_uid.isdigit() else pwd.getpwnam(name_or_uid)
        if entry.pw_uid == 0:
            raise ValueError("the job user must not be root")
        return cls(entry.pw_uid, entry.pw_gid)


def _prepare(job_dir: Path, job_user: JobUser | None) -> None:
    """Lays out the job folder. request.json and the folder itself stay the worker's; work/, home/,
    tmp/ and report/ (the child's only writable places) go to the job user."""
    for sub in CHILD_DIRS:
        (job_dir / sub).mkdir(exist_ok=True)
        (job_dir / sub).chmod(0o700)
    if job_user is None:
        return
    job_dir.chmod(0o711)
    (job_dir / "request.json").chmod(0o644)
    for sub in CHILD_DIRS:
        top = job_dir / sub
        os.chown(top, job_user.uid, job_user.gid, follow_symlinks=False)
        for root, dirs, files in os.walk(top):
            for name in dirs + files:
                os.chown(Path(root) / name, job_user.uid, job_user.gid, follow_symlinks=False)


def run_isolated(
    handler: str,
    payload: dict[str, Any],
    job_input: dict[str, Any],
    job_dir: Path,
    *,
    timeout_s: float,
    memory_bytes: int,
    job_user: JobUser | None = None,
) -> Outcome:
    """Runs `handler` ("module:function") with `job_dir/work` as its folder, as `job_user` when given
    (the worker must then be root). `job_dir` must exist; the caller deletes it."""
    (job_dir / "request.json").write_text(json.dumps({"handler": handler, "payload": payload, "input": job_input}))
    _prepare(job_dir, job_user)
    if sys.platform != "linux":
        log.warning("no memory cap on %s: RLIMIT_AS is enforced on Linux only", sys.platform)
    count = _uid_task_count(None if job_user is None else job_user.uid)
    identity = {} if job_user is None else {"user": job_user.uid, "group": job_user.gid, "extra_groups": []}
    proc = subprocess.Popen(  # noqa: S603 - fixed interpreter and module, no shell
        [sys.executable, "-m", "stash_worker.child", str(job_dir)],
        cwd=job_dir / "work",
        env=_child_env(job_dir),
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        # Runs in the child after the switch to the job user, so the limits bind that uid.
        preexec_fn=_limit(memory_bytes, None if count is None else count + CHILD_PROCESSES),  # noqa: PLW1509
        **identity,
    )
    try:
        code = proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        _kill_group(proc.pid)
        proc.wait()
        return Outcome("timeout", detail=f"no result after {timeout_s:g} s")
    finally:
        _kill_group(proc.pid)

    outcome = _read_outcome(job_dir)
    if isinstance(outcome, str):
        how = f"signal {-code}" if code < 0 else f"exit {code}"
        return Outcome("crashed", detail=f"child ended with {how}: {outcome}")
    return _interpret(outcome)
