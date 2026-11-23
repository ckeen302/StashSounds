"""Moving files between storage and a job folder. Runs in the parent, never in the child.

- `stage_inputs` downloads the job's uploaded files to `work/in/<file id>`, checking each against its
  type's size limit before downloading and capping the download at the size the database measured.
- `publish_outputs` uploads the derived files a validated result names. Each must sit in the previews
  bucket under the item's folder, be a regular file reached without following any link, and match the
  result's size and SHA-256. Every file is checked, and copied to a folder only the parent can write,
  before any upload starts.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from stash_worker.contracts import limits
from stash_worker.safefs import UnsafePath, open_beneath, split_relative
from stash_worker.storage import IMMUTABLE, Storage, StorageError


class InputRejected(Exception):  # noqa: N818
    """An input file breaks a limit: the job fails without retry with `reason`."""

    def __init__(self, reason: str, detail: str):
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


def _check_and_copy(out_dir: Path, f: dict[str, Any], item_id: str, dest: Path) -> None:
    if f["bucket"] != "previews":
        raise PublishError(f"the worker publishes only previews, not {f['bucket']}/{f['path']}")
    try:
        parts = split_relative(f["path"])
    except UnsafePath as e:
        raise PublishError(str(e)) from e
    if parts[0] != item_id or len(parts) < 2:
        raise PublishError(f"{f['path']} is outside this item's folder")
    if not f.get("sha256"):
        raise PublishError(f"{f['path']} has no sha256")
    try:
        fd = open_beneath(out_dir, ["previews", *parts])
    except UnsafePath as e:
        raise PublishError(str(e)) from e
    digest, size = hashlib.sha256(), 0
    with os.fdopen(fd, "rb") as src, dest.open("wb") as copy:
        while chunk := src.read(1 << 20):
            size += len(chunk)
            if size > f["bytes"]:
                raise PublishError(f"{f['path']} is larger than the result says")
            digest.update(chunk)
            copy.write(chunk)
    if size != f["bytes"] or digest.hexdigest() != f["sha256"]:
        raise PublishError(f"{f['path']} does not match its size and sha256 in the result")


def publish_outputs(storage: Storage, result: dict[str, Any], out_dir: Path, item_id: str) -> None:
    files = result.get("files", [])
    staging = Path(tempfile.mkdtemp(prefix="stash-publish-"))
    try:
        copies = []
        for i, f in enumerate(files):
            copy = staging / str(i)
            _check_and_copy(out_dir, f, item_id, copy)
            copies.append((f, copy))
        for f, copy in copies:
            storage.upload(f["bucket"], f["path"], copy, f["mime"], IMMUTABLE)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
