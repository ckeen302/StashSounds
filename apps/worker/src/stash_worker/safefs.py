"""Reading files a job's child process could have tampered with.

The child owns everything under its job folder's `work/` and `report/`, so any name there may be a
symlink to something only the worker can read. These helpers open a path one component at a time
with O_NOFOLLOW, so no component, file or folder, is ever followed through a link.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path, PurePosixPath


class UnsafePath(Exception):  # noqa: N818
    pass


def split_relative(rel: str) -> list[str]:
    parts = list(PurePosixPath(rel).parts)
    if not parts or rel.startswith("/") or any(p in ("", ".", "..") for p in parts):
        raise UnsafePath(f"not a plain relative path: {rel!r}")
    return parts


def open_beneath(root: Path, parts: list[str]) -> int:
    """An fd for root/parts[0]/.../parts[-1], refusing a symlink at any step after root, and
    anything but a regular file at the end. The caller closes it."""
    try:
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as e:
        raise UnsafePath(f"cannot open {root.name} safely: {e.strerror}") from e
    try:
        for name in parts[:-1]:
            nxt = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        leaf = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except OSError as e:
        raise UnsafePath(f"cannot open {'/'.join(parts)} safely: {e.strerror}") from e
    finally:
        os.close(fd)
    if not stat.S_ISREG(os.fstat(leaf).st_mode):
        os.close(leaf)
        raise UnsafePath(f"{'/'.join(parts)} is not a regular file")
    return leaf
