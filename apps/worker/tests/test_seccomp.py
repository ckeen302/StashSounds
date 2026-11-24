"""The seccomp program, decoded instruction by instruction (PR #8 third review).

The syscall numbers here are written out again from the kernel headers (arch/x86/entry/syscalls/
syscall_64.tbl and include/uapi/asm-generic/unistd.h), not read from seccomp.py, so a wrong number there
fails here.
"""

from __future__ import annotations

import errno
import struct

import pytest

from stash_worker import seccomp
from stash_worker.seccomp import ARCHES, DENIED, program

LD, JEQ, JGE, JSET, RET = 0x20, 0x15, 0x35, 0x45, 0x06
KILL, ALLOW = 0x80000000, 0x7FFF0000
EPERM = 0x00050000 | errno.EPERM
ENOSYS = 0x00050000 | errno.ENOSYS
CLONE_NEW = 0x7E020000  # NEWNS | NEWCGROUP | NEWUTS | NEWIPC | NEWUSER | NEWPID | NEWNET

X86_64 = {
    "unshare": 272, "setns": 308, "mount": 165, "umount2": 166, "pivot_root": 155, "bpf": 321,
    "perf_event_open": 298, "keyctl": 250, "add_key": 248, "request_key": 249, "fanotify_init": 300,
    "open_by_handle_at": 304, "name_to_handle_at": 303, "ptrace": 101, "process_vm_readv": 310,
    "process_vm_writev": 311, "userfaultfd": 323, "clone": 56, "clone3": 435,
}  # fmt: skip
AARCH64 = {
    "unshare": 97, "setns": 268, "mount": 40, "umount2": 39, "pivot_root": 41, "bpf": 280,
    "perf_event_open": 241, "keyctl": 219, "add_key": 217, "request_key": 218, "fanotify_init": 262,
    "open_by_handle_at": 265, "name_to_handle_at": 264, "ptrace": 117, "process_vm_readv": 270,
    "process_vm_writev": 271, "userfaultfd": 282, "clone": 220, "clone3": 435,
}  # fmt: skip
# Since Linux 5.1 new calls share one number on every architecture.
COMMON = {
    "io_uring_setup": 425, "io_uring_enter": 426, "io_uring_register": 427, "open_tree": 428,
    "move_mount": 429, "fsopen": 430, "fsconfig": 431, "fsmount": 432, "fspick": 433,
    "mount_setattr": 442,
}  # fmt: skip
NUMBERS = {"x86_64": {**X86_64, **COMMON}, "aarch64": {**AARCH64, **COMMON}}
AUDIT = {"x86_64": 0xC000003E, "aarch64": 0xC00000B7}

MUST_DENY = {
    "unshare", "setns", "mount", "umount2", "pivot_root", "bpf", "perf_event_open", "keyctl", "add_key",
    "request_key", "fanotify_init", "open_by_handle_at", "name_to_handle_at", "ptrace", "process_vm_readv",
    "process_vm_writev", "userfaultfd",
    # decision 0017 addendum: the new mount API and io_uring
    "open_tree", "move_mount", "fsopen", "fsconfig", "fsmount", "fspick", "mount_setattr",
    "io_uring_setup", "io_uring_enter", "io_uring_register",
}  # fmt: skip


def decode(arch: str) -> list[tuple[int, int, int, int]]:
    return [struct.unpack("HBBI", op) for op in program(ARCHES[arch])]


def test_the_deny_list_is_the_decided_one():
    assert set(DENIED) == MUST_DENY
    assert len(DENIED) == len(MUST_DENY)


@pytest.mark.parametrize("arch", ["x86_64", "aarch64"])
def test_every_syscall_number_matches_the_kernel_headers(arch: str):
    assert ARCHES[arch].syscalls == NUMBERS[arch]
    assert ARCHES[arch].audit == AUDIT[arch]


@pytest.mark.parametrize("arch", ["x86_64", "aarch64"])
def test_the_program_in_order(arch: str):
    nr = NUMBERS[arch]
    expected = [
        (LD, 0, 0, 4),  # seccomp_data.arch
        (JEQ, 1, 0, AUDIT[arch]),
        (RET, 0, 0, KILL),  # a foreign architecture
        (LD, 0, 0, 0),  # seccomp_data.nr
    ]
    if arch == "x86_64":
        expected += [(JGE, 0, 1, 0x40000000), (RET, 0, 0, EPERM)]  # the x32 ABI
    for name in DENIED:
        expected += [(JEQ, 0, 1, nr[name]), (RET, 0, 0, EPERM)]
    expected += [
        (JEQ, 0, 1, nr["clone3"]),
        (RET, 0, 0, ENOSYS),
        (JEQ, 0, 3, nr["clone"]),
        (LD, 0, 0, 16),  # args[0], low 32 bits
        (JSET, 0, 1, CLONE_NEW),
        (RET, 0, 0, EPERM),
        (RET, 0, 0, ALLOW),  # the default
    ]
    assert decode(arch) == expected
    assert len(expected) < 4096  # BPF_MAXINSNS


def run(ops: list[tuple[int, int, int, int]], arch: int, nr: int, arg0: int = 0) -> int:
    """A classic BPF interpreter for the five opcodes the filter uses."""
    data = struct.pack("<iIQ6Q", nr, arch, 0, arg0, 0, 0, 0, 0, 0)
    acc, pc = 0, 0
    while True:
        code, jt, jf, k = ops[pc]
        pc += 1
        if code == LD:
            acc = struct.unpack_from("<I", data, k)[0]
        elif code == RET:
            return k
        elif code in (JEQ, JGE, JSET):
            hit = {JEQ: acc == k, JGE: acc >= k, JSET: bool(acc & k)}[code]
            pc += jt if hit else jf
        else:
            raise AssertionError(f"unexpected opcode {code:#x}")


@pytest.mark.parametrize("arch", ["x86_64", "aarch64"])
def test_the_program_answers_each_call(arch: str):
    ops, audit, nr = decode(arch), AUDIT[arch], NUMBERS[arch]
    for name in MUST_DENY:
        assert run(ops, audit, nr[name]) == EPERM, name
    assert run(ops, audit, nr["clone3"]) == ENOSYS
    assert run(ops, audit, nr["clone"], 0x11) == ALLOW  # fork: SIGCHLD only
    assert run(ops, audit, nr["clone"], 0x003D0F00) == ALLOW  # a pthread
    for flag in (0x00020000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000):
        assert run(ops, audit, nr["clone"], flag | 0x11) == EPERM, hex(flag)
    for allowed in (0, 1, 3, 9, 59, 63, 202, 221, 231, 260, 424, 434, 436, 450):  # read, write, openat...
        if allowed not in {nr[n] for n in MUST_DENY | {"clone", "clone3"}}:
            assert run(ops, audit, allowed) == ALLOW, allowed
    other = AUDIT["aarch64" if arch == "x86_64" else "x86_64"]
    assert run(ops, other, 0) == KILL
    assert run(ops, 0x40000003, 0) == KILL  # i386


def test_x32_numbers_are_refused_on_x86_64():
    ops = decode("x86_64")
    assert run(ops, AUDIT["x86_64"], 0x40000000 | 0) == EPERM
    assert run(ops, AUDIT["x86_64"], 0x40000000 | 56) == EPERM


def test_both_architectures_name_the_same_calls():
    assert set(ARCHES["x86_64"].syscalls) == set(ARCHES["aarch64"].syscalls) == set(DENIED) | {"clone", "clone3"}
    assert seccomp.ARCHES["arm64"] is seccomp.ARCHES["aarch64"]
