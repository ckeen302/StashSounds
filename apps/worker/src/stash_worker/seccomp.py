"""The job child's own seccomp filter (decision 0017, PR #8 re-review N1).

Docker relaxes its default seccomp profile for the whole container once it has CAP_SYS_ADMIN, which the
worker needs to give each child its own network namespace. So the child, after dropping to the job uid,
sets PR_SET_NO_NEW_PRIVS and installs this filter itself, built here as classic BPF and loaded with
prctl (libseccomp is LGPL, so it is not used). The filter:

- kills the process when the syscall's audit architecture is not the one it was built for, and on
  x86_64 refuses x32 syscall numbers;
- returns EPERM for the calls that open kernel attack surface or reach other processes: unshare, setns,
  mount, umount2, pivot_root, bpf, perf_event_open, keyctl, add_key, request_key, fanotify_init,
  open_by_handle_at, name_to_handle_at, ptrace, process_vm_readv, process_vm_writev, userfaultfd;
- returns EPERM for clone with any CLONE_NEW* flag, and ENOSYS for clone3 (whose flags sit in memory a
  filter cannot read), so libc falls back to clone;
- allows everything else.

`Filter.build()` runs in the parent; `Filter.install()` is all the forked child does: two prctl calls.
"""

from __future__ import annotations

import ctypes
import errno
import platform
import struct
from dataclasses import dataclass

PR_SET_NO_NEW_PRIVS = 38
PR_SET_SECCOMP = 22
SECCOMP_MODE_FILTER = 2

SECCOMP_RET_KILL_PROCESS = 0x80000000
SECCOMP_RET_ERRNO = 0x00050000
SECCOMP_RET_ALLOW = 0x7FFF0000

# Classic BPF opcodes (linux/filter.h, linux/bpf_common.h).
BPF_LD_W_ABS = 0x00 | 0x00 | 0x20
BPF_JMP_JEQ_K = 0x05 | 0x10 | 0x00
BPF_JMP_JGE_K = 0x05 | 0x30 | 0x00
BPF_JMP_JSET_K = 0x05 | 0x40 | 0x00
BPF_RET_K = 0x06 | 0x00

# struct seccomp_data: int nr; __u32 arch; __u64 instruction_pointer; __u64 args[6]. Both supported
# architectures are little-endian, so an argument's low 32 bits are at its own offset.
OFFSET_NR = 0
OFFSET_ARCH = 4
OFFSET_ARG0_LOW = 16

# CLONE_NEWNS | NEWCGROUP | NEWUTS | NEWIPC | NEWUSER | NEWPID | NEWNET (linux/sched.h). CLONE_NEWTIME
# (0x80) is not checked for clone: those bits are the exit signal there, and only clone3 and unshare
# accept it, and both are refused.
CLONE_NEW_MASK = 0x00020000 | 0x02000000 | 0x04000000 | 0x08000000 | 0x10000000 | 0x20000000 | 0x40000000

DENIED = (
    "unshare",
    "setns",
    "mount",
    "umount2",
    "pivot_root",
    "bpf",
    "perf_event_open",
    "keyctl",
    "add_key",
    "request_key",
    "fanotify_init",
    "open_by_handle_at",
    "name_to_handle_at",
    "ptrace",
    "process_vm_readv",
    "process_vm_writev",
    "userfaultfd",
)


@dataclass(frozen=True)
class Arch:
    audit: int
    syscalls: dict[str, int]
    x32_bit: int | None = None  # x86_64: syscall numbers with this bit are the x32 ABI


# Numbers from asm/unistd_64.h (x86_64) and asm-generic/unistd.h (aarch64).
ARCHES = {
    "x86_64": Arch(
        audit=0xC000003E,
        x32_bit=0x40000000,
        syscalls={
            "unshare": 272,
            "setns": 308,
            "mount": 165,
            "umount2": 166,
            "pivot_root": 155,
            "bpf": 321,
            "perf_event_open": 298,
            "keyctl": 250,
            "add_key": 248,
            "request_key": 249,
            "fanotify_init": 300,
            "open_by_handle_at": 304,
            "name_to_handle_at": 303,
            "ptrace": 101,
            "process_vm_readv": 310,
            "process_vm_writev": 311,
            "userfaultfd": 323,
            "clone": 56,
            "clone3": 435,
        },
    ),
    "aarch64": Arch(
        audit=0xC00000B7,
        syscalls={
            "unshare": 97,
            "setns": 268,
            "mount": 40,
            "umount2": 39,
            "pivot_root": 41,
            "bpf": 280,
            "perf_event_open": 241,
            "keyctl": 219,
            "add_key": 217,
            "request_key": 218,
            "fanotify_init": 262,
            "open_by_handle_at": 265,
            "name_to_handle_at": 264,
            "ptrace": 117,
            "process_vm_readv": 270,
            "process_vm_writev": 271,
            "userfaultfd": 282,
            "clone": 220,
            "clone3": 435,
        },
    ),
}
ARCHES["arm64"] = ARCHES["aarch64"]


class Unsupported(Exception):  # noqa: N818
    pass


def _op(code: int, k: int, jt: int = 0, jf: int = 0) -> bytes:
    return struct.pack("HBBI", code, jt, jf, k)


def program(arch: Arch) -> list[bytes]:
    """The filter as a list of struct sock_filter."""
    sc = arch.syscalls
    deny = SECCOMP_RET_ERRNO | errno.EPERM
    ops = [
        _op(BPF_LD_W_ABS, OFFSET_ARCH),
        _op(BPF_JMP_JEQ_K, arch.audit, jt=1),
        _op(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
        _op(BPF_LD_W_ABS, OFFSET_NR),
    ]
    if arch.x32_bit is not None:
        ops += [_op(BPF_JMP_JGE_K, arch.x32_bit, jf=1), _op(BPF_RET_K, deny)]
    for name in DENIED:
        ops += [_op(BPF_JMP_JEQ_K, sc[name], jf=1), _op(BPF_RET_K, deny)]
    ops += [_op(BPF_JMP_JEQ_K, sc["clone3"], jf=1), _op(BPF_RET_K, SECCOMP_RET_ERRNO | errno.ENOSYS)]
    # clone: refuse any CLONE_NEW* flag in its first argument; then allow everything left.
    ops += [
        _op(BPF_JMP_JEQ_K, sc["clone"], jf=3),
        _op(BPF_LD_W_ABS, OFFSET_ARG0_LOW),
        _op(BPF_JMP_JSET_K, CLONE_NEW_MASK, jf=1),
        _op(BPF_RET_K, deny),
        _op(BPF_RET_K, SECCOMP_RET_ALLOW),
    ]
    return ops


class _SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_void_p)]


class Filter:
    """A filter built ahead of fork, so the child only makes the two prctl calls."""

    def __init__(self, machine: str | None = None):
        name = machine or platform.machine()
        arch = ARCHES.get(name)
        if arch is None:
            raise Unsupported(f"no seccomp filter for {name!r}")
        self._code = ctypes.create_string_buffer(b"".join(program(arch)))
        self._prog = _SockFprog(len(self._code.raw) // 8, ctypes.addressof(self._code))
        self._libc = ctypes.CDLL(None, use_errno=True)
        self._libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]

    def install(self) -> None:
        """Sets no_new_privs and loads the filter into this process. Raises OSError on failure."""
        if self._libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
            e = ctypes.get_errno()
            raise OSError(e, f"PR_SET_NO_NEW_PRIVS: {errno.errorcode.get(e, e)}")
        if self._libc.prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ctypes.addressof(self._prog), 0, 0) != 0:
            e = ctypes.get_errno()
            raise OSError(e, f"PR_SET_SECCOMP: {errno.errorcode.get(e, e)}")
