"""Duplicate screening in the parent (build spec: Worker jobs, common step 2 and Fingerprint; ticket 114).

After the child's result is validated and before anything is published, the parent:
1. takes each original's SHA-256 from staging (files.stage_inputs hashes it before the child starts;
   the child owns work/in afterwards, so the parent never reads it again);
2. asks the database for candidates (public.worker_duplicate_candidates, request 114-duplicate-lookup),
   which also records the hash on the original: other items' originals with the same hash, and other
   items' fingerprints whose duration is within DURATION_RATIO of the upload's;
3. flags the result `duplicate_exact` on a hash match, else `duplicate_fingerprint` when a fingerprint's
   similarity is over limits.worker.fingerprintThreshold.

The uploader's own earlier upload counts too (ticket 114); the reason texts already invite review, and
the detail says it was their own. A match against another user wins over one against the uploader, and
an exact match wins over a fingerprint.
"""

from __future__ import annotations

import copy
import hashlib
import logging
import math
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from stash_worker.contracts import limits

# Candidates are fingerprints from DURATION_RATIO to 1 / DURATION_RATIO of the upload's duration, so a
# copy trimmed by up to a quarter is still compared.
DURATION_RATIO = 0.75
# The alignment must overlap at least this share of the shorter fingerprint.
MIN_OVERLAP = 0.9
# At most this many fingerprints are compared per original, nearest duration first, so the parent's
# work stays bounded whatever the catalog holds (about 0.1 s for 200 sixty-second loops).
MAX_FINGERPRINT_CANDIDATES = 200

log = logging.getLogger(__name__)


class DuplicateLookup(Protocol):
    def duplicate_candidates(
        self, job_id: str, attempt: int, file_id: str, sha256: str, min_ms: int | None, max_ms: int | None
    ) -> list[dict[str, Any]]: ...


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def duration_window(duration_ms: int) -> tuple[int, int]:
    return math.ceil(duration_ms * DURATION_RATIO), math.floor(duration_ms / DURATION_RATIO)


def similarity(a: list[int], b: list[int]) -> float:
    """1 minus the bit error rate at the best alignment of two raw Chromaprint fingerprints, over the
    offsets where they overlap by at least MIN_OVERLAP of the shorter one. 0 when either is empty."""
    if not a or not b:
        return 0.0
    x = np.asarray(a, dtype=np.int64).astype(np.uint32)
    y = np.asarray(b, dtype=np.int64).astype(np.uint32)
    short, long_ = (x, y) if len(x) <= len(y) else (y, x)
    need = max(1, math.ceil(len(short) * MIN_OVERLAP))
    best = 0.0
    # `off` is where short[0] sits in long_; short[i] pairs with long_[i + off].
    for off in range(need - len(short), len(long_) - need + 1):
        lo, hi = max(0, -off), min(len(short), len(long_) - off)
        n = hi - lo
        if n < need:
            continue
        errors = int(np.bitwise_count(short[lo:hi] ^ long_[lo + off : hi + off]).sum())
        best = max(best, 1 - errors / (32 * n))
    return best


def _flag(match: str, own: bool, score: float | None) -> dict[str, Any]:
    whose = "your own earlier upload" if own else "an upload already on Stash"
    if match == "exact":
        return {"reason": "duplicate_exact", "detail": f"The same file as {whose}."}
    return {"reason": "duplicate_fingerprint", "detail": f"Sounds the same as {whose} (similarity {score:.3f})."}


def screen(
    queue: DuplicateLookup, job_input: dict[str, Any], result: dict[str, Any], digests: dict[str, str]
) -> dict[str, Any]:
    """The result with `flag` set when an original duplicates another item's. `digests` is {file id:
    SHA-256} from staging. Raises ValueError when the result fingerprints a file that is not one of this
    job's originals or an original has no digest, and the queue's errors as they are. A flag the
    handler already set is kept."""
    out = copy.deepcopy(result)
    originals = [f for f in job_input["files"] if f["role"] == "original"]
    by_path = {f["path"]: f for f in originals}
    prints = {}
    for fp in out.get("fingerprints", []):
        if fp["filePath"] not in by_path:
            raise ValueError(f"a fingerprint for {fp['filePath']!r}, not this job's original")
        prints[fp["filePath"]] = fp
    threshold = float(limits()["worker"]["fingerprintThreshold"])

    found: list[tuple[int, int, str, bool, float | None]] = []
    for f in originals:
        sha = digests.get(f["id"])
        if sha is None:
            raise ValueError(f"no digest for original {f['id']}")
        fp = prints.get(f["path"])
        lo, hi = duration_window(int(fp["durationMs"])) if fp else (None, None)
        rows = queue.duplicate_candidates(job_input["jobId"], int(job_input["attempt"]), f["id"], sha, lo, hi)
        prints_rows = []
        for row in rows:
            own = str(row["owner_id"]) == str(job_input["ownerId"])
            if row["match"] == "exact":
                found.append((0, int(own), "exact", own, None))
            elif row["match"] == "fingerprint" and fp and row.get("chromaprint"):
                prints_rows.append((own, row))
        if fp is not None and len(prints_rows) > MAX_FINGERPRINT_CANDIDATES:
            log.warning(
                "item %s: compared the nearest %d of %d fingerprints in the duration window",
                job_input["itemId"],
                MAX_FINGERPRINT_CANDIDATES,
                len(prints_rows),
            )
        if fp is not None:
            prints_rows.sort(key=lambda r: abs(int(r[1]["duration_ms"]) - int(fp["durationMs"])))
        for own, row in prints_rows[:MAX_FINGERPRINT_CANDIDATES]:
            score = similarity(fp["chromaprint"], list(row["chromaprint"]))
            if score > threshold:
                found.append((1, int(own), "fingerprint", own, score))
    if found and not out.get("flag"):
        # Exact before fingerprint, another user before the uploader, then the closest match.
        found.sort(key=lambda m: (m[0], m[1], -(m[4] or 0)))
        _, _, match, own, score = found[0]
        out["flag"] = _flag(match, own, score)
    return out
