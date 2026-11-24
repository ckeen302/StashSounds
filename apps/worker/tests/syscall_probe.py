"""Calls that the child's seccomp filter refuses but an ordinary unprivileged process here may make.

Each probe is chosen so its answer differs with the filter on and off (PR #8 third review): with the
filter every one is EPERM; without it, on a Linux host, each succeeds for root and for an unprivileged
uid alike. mount, clone(CLONE_NEWNS) and bpf are not here, because without CAP_SYS_ADMIN they fail
with EPERM whether or not the filter is loaded.

Run as a script, it prints the answers as JSON.
"""

from __future__ import annotations

import ctypes
import errno
import json
import os
import platform

CLONE_NEWUSER = 0x10000000
SIGCHLD = 17
KEYCTL_GET_KEYRING_ID = 0
KEY_SPEC_SESSION_KEYRING = -3
UFFD_USER_MODE_ONLY = 1
AT_FDCWD = -100
OPEN_TREE_CLOEXEC = 0o2000000
IO_URING_PARAMS_BYTES = 120


def probe() -> dict[str, str]:
    from stash_worker.seccomp import ARCHES

    nr = ARCHES[platform.machine()].syscalls
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long

    def call(name: str, *args: object) -> int:
        ctypes.set_errno(0)
        return libc.syscall(nr[name], *args)

    def answer(r: int) -> str:
        if r < 0:
            return errno.errorcode.get(ctypes.get_errno(), str(ctypes.get_errno()))
        return "ok"

    facts: dict[str, str] = {}
    # A raw clone into a new user namespace: the new child exits at once.
    pid = call("clone", ctypes.c_ulong(CLONE_NEWUSER | SIGCHLD), 0, 0, 0, 0)
    if pid == 0:
        os._exit(0)
    if pid > 0:
        os.waitpid(pid, 0)
    facts["clone_newuser"] = answer(pid)
    facts["keyctl"] = answer(call("keyctl", KEYCTL_GET_KEYRING_ID, ctypes.c_long(KEY_SPEC_SESSION_KEYRING), 0))
    facts["add_key"] = answer(
        call("add_key", b"user", b"stash-probe", b"x", ctypes.c_size_t(1), ctypes.c_long(KEY_SPEC_SESSION_KEYRING))
    )
    fd = call("userfaultfd", UFFD_USER_MODE_ONLY)
    facts["userfaultfd"] = answer(fd)
    params = ctypes.create_string_buffer(IO_URING_PARAMS_BYTES)
    ring = call("io_uring_setup", 1, params)
    facts["io_uring_setup"] = answer(ring)
    tree = call("open_tree", AT_FDCWD, b"/", OPEN_TREE_CLOEXEC)
    facts["open_tree"] = answer(tree)
    for f in (fd, ring, tree):
        if f >= 0:
            os.close(f)
    return facts


if __name__ == "__main__":
    print(json.dumps(probe()))
