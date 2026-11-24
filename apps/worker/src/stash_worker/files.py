"""Moving files between storage and a job folder. Runs in the parent, never in the child.

- `stage_inputs` downloads the job's uploaded files to `work/in/<file id>`, checking each against its
  type's size limit before downloading and capping the download at the size the database measured.
- `publish_outputs` uploads the derived files a validated result names, to the public previews bucket
  with immutable caching. The child is not trusted with anything that reaches that bucket: the parent
  decides from each file's role which roles an item type may have (one file each), the exact name
  (`<item>/<sha256[:32]>.<ext>`), the content type, a byte cap and what the first bytes must be. Each
  file must be a regular, singly linked file the job uid owns, reached without following any link,
  and must match the result's size and SHA-256. Every file is checked, and copied to a folder only the
  parent can write, before any upload starts.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import os
import re
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from stash_worker.contracts import limits
from stash_worker.jobs import rejection_reasons
from stash_worker.safefs import UnsafePath, open_beneath
from stash_worker.storage import IMMUTABLE, Storage, StorageError

SHA256 = re.compile(r"[0-9a-f]{64}")
HASH_CHARS = 32  # of the SHA-256, in derived file names


class InputRejected(Exception):  # noqa: N818
    """An input file breaks a limit: the job fails without retry with `reason`, a file-fault reason
    from the contracts, like jobs.Rejected."""

    def __init__(self, reason: str, detail: str):
        if reason not in rejection_reasons():
            raise ValueError(f"not a file rejection reason: {reason!r}")
        super().__init__(f"{reason}: {detail}")
        self.reason = reason
        self.detail = detail


class PublishError(Exception):
    """The child's outputs do not match its result. Treated as a crash: internal, retryable."""


def max_bytes_for(item_type: str, role: str) -> int:
    lim = limits()
    if role == "demo":
        return int(lim["preset"]["demo"]["maxBytes"])
    return int(lim[item_type]["maxBytes"])


def stage_inputs(storage: Storage, job_input: dict[str, Any], in_dir: Path) -> None:
    in_dir.mkdir(parents=True, exist_ok=True)
    for f in job_input["files"]:
        limit = max_bytes_for(job_input["type"], f["role"])
        if f["bytes"] > limit:
            raise InputRejected("too_large", f"{f['role']} is {f['bytes']} bytes, the limit is {limit}")
    for f in job_input["files"]:
        got = storage.download(f["bucket"], f["path"], in_dir / f["id"], max_bytes=f["bytes"])
        if got != f["bytes"]:
            raise StorageError(f"{f['path']} is {got} bytes, the database says {f['bytes']}")


# -- what each item type may publish ---------------------------------------------------------------------


def loop_preview_max_bytes() -> int:
    """The largest loop preview the parent publishes: limits.preview.loopMaxBytes (decision 0017)."""
    return int(limits()["preview"]["loopMaxBytes"])


def loop_preview_needed_bytes() -> int:
    """What the longest loop's preview can take: the longest loop at the bitrate it is encoded at,
    whichever regime is bigger, plus 5% and 16 KiB for frame padding and the ID3 and Xing headers.
    The limit must be at least this, or a valid preview would be refused."""
    lim = limits()
    p = lim["preview"]
    short = p["loopShortMaxMs"] / 1000 * p["loopBitrateKbpsShort"] * 1000 / 8
    long = lim["loop"]["maxDurationMs"] / 1000 * p["loopBitrateKbpsLong"] * 1000 / 8
    return int(max(short, long) * 1.05) + 16 * 1024


def _is_mp3(head: bytes, f: dict[str, Any]) -> str | None:
    if head.startswith(b"ID3") or (len(head) >= 2 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return None
    return "does not start with an ID3 tag or an MPEG frame"


def _is_peaks(data: bytes, f: dict[str, Any]) -> str | None:
    points = int(limits()["waveform"]["peakPoints"])
    meta = f.get("meta") or {}
    try:
        claimed = base64.b64decode(meta.get("peaks", ""), validate=True)
    except (binascii.Error, TypeError, ValueError):
        return "meta.peaks is not base64"
    if meta.get("points") != points or claimed != data:
        return f"meta does not hold the same {points} bytes"
    return None


@dataclass(frozen=True)
class Rule:
    ext: str
    mime: str
    max_bytes: Callable[[], int]
    exact_bytes: bool  # the file is exactly max_bytes long
    check: Callable[[bytes, dict[str, Any]], str | None]  # given the first bytes (all of them if small)
    whole: bool = False  # check sees the whole file


OUTPUTS: dict[str, dict[str, Rule]] = {
    "loop": {
        "preview": Rule("mp3", "audio/mpeg", loop_preview_max_bytes, False, _is_mp3),
        "peaks": Rule(
            "peaks",
            "application/octet-stream",
            lambda: int(limits()["waveform"]["peakPoints"]),
            True,
            _is_peaks,
            whole=True,
        ),
    },
}


def _check_and_copy(
    out_dir: Path, f: dict[str, Any], rule: Rule, item_id: str, owner_uid: int | None, dest: Path
) -> None:
    where = f"{f.get('role')!r} {f.get('path')!r}"
    if f.get("bucket") != "previews":
        raise PublishError(f"{where}: the worker publishes only to previews")
    if f.get("mime") != rule.mime:
        raise PublishError(f"{where}: must be {rule.mime}, not {f.get('mime')!r}")
    digest = f.get("sha256")
    if not isinstance(digest, str) or not SHA256.fullmatch(digest):
        raise PublishError(f"{where}: no valid sha256")
    name = f"{digest[:HASH_CHARS]}.{rule.ext}"
    if f.get("path") != f"{item_id}/{name}":
        raise PublishError(f"{where}: must be named {item_id}/{name}")
    cap = rule.max_bytes()
    size_claimed = f.get("bytes")
    if not isinstance(size_claimed, int) or size_claimed > cap or (rule.exact_bytes and size_claimed != cap):
        raise PublishError(f"{where}: {size_claimed!r} bytes, the limit is {cap}")
    try:
        fd = open_beneath(out_dir, ["previews", item_id, name], owner_uid)
    except UnsafePath as e:
        raise PublishError(f"{where}: {e}") from e
    sha, size, head = hashlib.sha256(), 0, b""
    with os.fdopen(fd, "rb") as src, dest.open("wb") as copy:
        while chunk := src.read(1 << 20):
            size += len(chunk)
            if size > size_claimed:
                raise PublishError(f"{where}: larger than the result says")
            if len(head) < (cap if rule.whole else 16):
                head += chunk[: (cap if rule.whole else 16) - len(head)]
            sha.update(chunk)
            copy.write(chunk)
    if size != size_claimed or sha.hexdigest() != digest:
        raise PublishError(f"{where}: does not match its size and sha256 in the result")
    if problem := rule.check(head, f):
        raise PublishError(f"{where}: {problem}")


def publish_outputs(
    storage: Storage,
    result: dict[str, Any],
    out_dir: Path,
    item_id: str,
    item_type: str,
    owner_uid: int | None = None,
) -> None:
    """Uploads the result's files after checking all of them (see the module docstring). `owner_uid`
    is the uid the child ran as; its files must belong to it."""
    rules = OUTPUTS.get(item_type, {})
    files = result.get("files", [])
    seen: set[str] = set()
    for f in files:
        role = f.get("role")
        if role not in rules:
            raise PublishError(f"a {item_type} does not publish a {role!r} file")
        if role in seen:
            raise PublishError(f"a {item_type} publishes one {role!r} file")
        seen.add(role)
    staging = Path(tempfile.mkdtemp(prefix="stash-publish-"))
    try:
        copies = []
        for i, f in enumerate(files):
            copy = staging / str(i)
            rule = rules[f["role"]]
            _check_and_copy(out_dir, f, rule, item_id, owner_uid, copy)
            copies.append((f, rule, copy))
        for f, rule, copy in copies:
            storage.upload("previews", f["path"], copy, rule.mime, IMMUTABLE)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
