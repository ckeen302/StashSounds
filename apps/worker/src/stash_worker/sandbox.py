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
The job uid must be dedicated to jobs (`stash-job` in the image), because before and after every job
the worker kills every process that uid owns: a child that leaves its process group with setsid()
must not survive into the next job, where it could read that job's original or rewrite its outputs
(PR #8 review). The child also gets its own network namespace with no interfaces, so it can reach
neither storage nor the database nor a metadata endpoint; that needs CAP_SYS_ADMIN in the parent.

The child reports through <job_dir>/report/outcome.json, which is read as untrusted input: opened
without following links, size-capped, shape-checked, and anything unexpected counts as a crash.
"""

from __future__ import annotations

import ctypes
import json
import logging
import os
import pwd
import resource
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from stash_worker.contracts import limits
from stash_worker.jobs import rejection_reasons
from stash_worker.safefs import UnsafePath, open_beneath
from stash_worker.seccomp import Filter, Unsupported

log = logging.getLogger(__name__)

Status = Literal["ok", "rejected", "timeout", "crashed"]

# Largest file a job may write: an unpacked kit is the biggest thing a job ever holds.
CHILD_FILE_BYTES = int(limits()["kit"]["maxUnpackedBytes"])
# Processes (tasks, threads included) a job may run. As the job user this is the whole RLIMIT_NPROC,
# since the uid runs nothing else once survivors are killed. In same-uid mode (no job user) the kernel
# counts the worker uid's other tasks too, so the cap is that count plus this.
CHILD_PROCESSES = 64
CLEAR_TRIES = 200  # kill rounds, 10 ms apart, before a job uid that keeps forking is an error
# Largest outcome.json the parent will read. Results are metadata and paths, never audio.
OUTCOME_MAX_BYTES = 1 << 20
DETAIL_MAX = 500
ENV_PASSTHROUGH = ("PATH", "PYTHONPATH", "LANG", "LC_ALL")
CHILD_DIRS = ("work", "home", "tmp", "report")


@dataclass(frozen=True)
class Outcome:
    status: Status
    result: dict[str, Any] | None = None
    reason: str | None = None
    detail: str = ""


def _uid_task_count(uid: int | None = None, proc: Path = Path("/proc")) -> int | None:
    """Tasks (threads of every process) owned by this uid, from /proc (Linux), which is what the
    kernel counts for RLIMIT_NPROC. Counting processes instead undercounts a uid that runs a threaded
    service (a CI agent, a desktop session) and leaves the child unable to fork. None without /proc."""
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


def _child_setup(
    memory_bytes: int,
    nproc: int | None,
    job_user: JobUser | None,
    isolate_network: bool,
    syscall_filter: Filter | None,
):
    """Runs in the forked child before exec. Still root (when the worker is), it leaves the network,
    then becomes the job user with no supplementary groups, then sets no_new_privs and loads the
    seccomp filter (built in the parent), then applies the limits, so they bind that uid."""

    def apply() -> None:
        if isolate_network:
            os.unshare(os.CLONE_NEWNET)
        if job_user is not None:
            os.setgroups([])
            os.setresgid(job_user.gid, job_user.gid, job_user.gid)
            os.setresuid(job_user.uid, job_user.uid, job_user.uid)
        if syscall_filter is not None:
            syscall_filter.install()
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
    return env


def _kill_group(pgid: int) -> None:
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _read_outcome(job_dir: Path, owner_uid: int | None = None) -> dict[str, Any] | str:
    """The parsed report/outcome.json, or a string saying why it could not be used."""
    try:
        fd = open_beneath(job_dir, ["report", "outcome.json"], owner_uid)
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
    tmp/ and report/ (the child's only writable places) go to the job user.

    Ownership is handed over bottom-up through directory fds (os.fwalk), so the job user never owns a
    folder the worker is still walking, and no name is resolved through a link. No job-uid process is
    running at this point (clear_job_user), but the order would hold even if one were."""
    for sub in CHILD_DIRS:
        (job_dir / sub).mkdir(exist_ok=True)
        (job_dir / sub).chmod(0o700)
    if job_user is None:
        return
    job_dir.chmod(0o711)
    (job_dir / "request.json").chmod(0o644)
    uid, gid = job_user.uid, job_user.gid
    for sub in CHILD_DIRS:
        top = job_dir / sub
        for _root, dirs, files, root_fd in os.fwalk(top, topdown=False, follow_symlinks=False):
            for name in dirs + files:
                os.chown(name, uid, gid, dir_fd=root_fd, follow_symlinks=False)
        os.chown(top, uid, gid, follow_symlinks=False)


_PR_SET_CHILD_SUBREAPER = 36
_subreaper = False


def _become_subreaper() -> None:
    """Orphans of a job (a setsid double-fork) are re-parented to the worker instead of init, so the
    worker can reap them and the job uid's task count really reaches 0. Linux only."""
    global _subreaper  # noqa: PLW0603
    if _subreaper or sys.platform != "linux":
        return
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(_PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        log.warning("could not become a child subreaper: errno %d", ctypes.get_errno())
    _subreaper = True


def _reap_children_of(uid: int) -> None:
    """Reaps this process's dead children owned by uid (killed survivors), which would otherwise stay
    as zombies and keep counting toward the uid's RLIMIT_NPROC."""
    me = os.getpid()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != uid:
                continue
            stat = (entry / "stat").read_text()
        except OSError:
            continue
        fields = stat[stat.rindex(")") + 2 :].split()
        if int(fields[1]) == me:
            try:
                os.waitpid(int(entry.name), os.WNOHANG)
            except ChildProcessError:
                pass


_KILL_ALL = "import os, signal\ntry:\n    os.kill(-1, signal.SIGKILL)\nexcept ProcessLookupError:\n    pass\n"


def clear_job_user(job_user: JobUser) -> None:
    """Kills every process the job uid owns and waits until none is left. A helper started as that uid
    calls kill(-1, SIGKILL), which signals every process the caller may signal (its own uid's) but
    itself; the kernel walks the process list under a lock fork also needs, so nothing forks past it.
    Raises RuntimeError when the uid will not empty, so the job fails as internal rather than running
    beside a survivor."""
    _become_subreaper()
    for _ in range(CLEAR_TRIES):
        subprocess.run(  # noqa: S603 - fixed interpreter and code, no shell
            [sys.executable, "-I", "-S", "-c", _KILL_ALL],
            user=job_user.uid,
            group=job_user.gid,
            extra_groups=[],
            env={},
            stdin=subprocess.DEVNULL,
            check=False,
            timeout=10,
        )
        if sys.platform != "linux":
            return
        _reap_children_of(job_user.uid)
        if _uid_task_count(job_user.uid) == 0:
            return
        time.sleep(0.01)
    raise RuntimeError(f"processes of uid {job_user.uid} keep running after SIGKILL")


def network_isolation_available() -> bool:
    """True when this process may give a child its own network namespace (root with CAP_SYS_ADMIN)."""
    if sys.platform != "linux":
        return False
    try:
        subprocess.run(  # noqa: S603 - fixed interpreter, no shell
            [sys.executable, "-I", "-S", "-c", "pass"],
            preexec_fn=lambda: os.unshare(os.CLONE_NEWNET),  # noqa: PLW1509
            check=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
        return False
    return True


_filter: Filter | None = None


def syscall_filter() -> Filter | None:
    """The child's seccomp filter for this machine, built once; None where there is none (not Linux,
    or an architecture without syscall numbers here)."""
    global _filter  # noqa: PLW0603
    if _filter is None and sys.platform == "linux":
        try:
            _filter = Filter()
        except Unsupported:
            return None
    return _filter


_STATUS_PROBE = (
    "import sys\n"
    "s = dict(l.split(':', 1) for l in open('/proc/self/status') if ':' in l)\n"
    "sys.exit(0 if (s['NoNewPrivs'].strip(), s['Seccomp'].strip()) == ('1', '2') else 1)\n"
)


def syscall_filter_available() -> bool:
    """True when a child here ends up with no_new_privs set and the filter loaded."""
    f = syscall_filter()
    if f is None:
        return False
    try:
        subprocess.run(  # noqa: S603 - fixed interpreter and code, no shell
            [sys.executable, "-I", "-S", "-c", _STATUS_PROBE],
            preexec_fn=f.install,  # noqa: PLW1509
            check=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
        return False
    return True


def _wait_unreaped(proc: subprocess.Popen, timeout_s: float) -> bool:
    """Waits for the child to exit without reaping it, so its pid (and process group id) stays
    reserved while the group is killed. False on timeout."""
    deadline = time.monotonic() + timeout_s
    while True:
        if os.waitid(os.P_PID, proc.pid, os.WEXITED | os.WNOWAIT | os.WNOHANG) is not None:
            return True
        left = deadline - time.monotonic()
        if left <= 0:
            return False
        time.sleep(min(0.02, left))


def run_isolated(
    handler: str,
    payload: dict[str, Any],
    job_input: dict[str, Any],
    job_dir: Path,
    *,
    timeout_s: float,
    memory_bytes: int,
    job_user: JobUser | None = None,
    isolate_network: bool | None = None,
) -> Outcome:
    """Runs `handler` ("module:function") with `job_dir/work` as its folder, as `job_user` when given
    (the worker must then be root). The child has no network when `isolate_network` (by default, when
    there is a job user). `job_dir` must exist; the caller deletes it."""
    if isolate_network is None:
        isolate_network = job_user is not None
    (job_dir / "request.json").write_text(json.dumps({"handler": handler, "payload": payload, "input": job_input}))
    if job_user is not None:
        clear_job_user(job_user)
    _prepare(job_dir, job_user)
    if sys.platform != "linux":
        log.warning("no memory cap on %s: RLIMIT_AS is enforced on Linux only", sys.platform)
    seccomp = syscall_filter()
    if job_user is not None and seccomp is None:
        raise RuntimeError("a job user needs the seccomp filter, which this machine has none of")
    if job_user is not None:
        nproc: int | None = CHILD_PROCESSES
    else:
        count = _uid_task_count()
        nproc = None if count is None else count + CHILD_PROCESSES
    try:
        proc = subprocess.Popen(  # noqa: S603 - fixed interpreter and module, no shell
            [sys.executable, "-m", "stash_worker.child", str(job_dir)],
            cwd=job_dir / "work",
            env=_child_env(job_dir),
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            preexec_fn=_child_setup(memory_bytes, nproc, job_user, isolate_network, seccomp),  # noqa: PLW1509
        )
        # The group is killed while the child is exited but not yet reaped, so its pid cannot have been
        # reused (PR #8 re-review A2); grandchildren that left the group are clear_job_user's.
        finished = _wait_unreaped(proc, timeout_s)
        _kill_group(proc.pid)
        code = proc.wait()
        if not finished:
            return Outcome("timeout", detail=f"no result after {timeout_s:g} s")
    finally:
        if job_user is not None:
            clear_job_user(job_user)

    outcome = _read_outcome(job_dir, os.getuid() if job_user is None else job_user.uid)
    if isinstance(outcome, str):
        how = f"signal {-code}" if code < 0 else f"exit {code}"
        return Outcome("crashed", detail=f"child ended with {how}: {outcome}")
    return _interpret(outcome)
