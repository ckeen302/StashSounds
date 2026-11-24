"""Chromaprint fingerprints through fpcalc (build spec: Worker jobs, Loop, Fingerprint; ticket 114).

Runs in the job's child. Chromaprint and fpcalc are LGPL-2.1+, so fpcalc is only ever run as a separate
program, the way ffmpeg is: nothing is linked or imported. fpcalc never parses the upload. It reads the
child's own decode (interleaved 44.1 kHz stereo float32) with the raw format forced, so the only
demuxer it uses is FFmpeg's raw PCM one.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from stash_worker.audio.ffmpeg import SAMPLE_RATE

# fpcalc fingerprints at most this many seconds; loops are at most 60 s.
MAX_SECONDS = 120
# What fpcalc prints for audio too short to fingerprint (about 2.6 s or less).
EMPTY = "Empty fingerprint"


class FingerprintFailed(Exception):
    pass


def fingerprint(decoded: Path) -> list[int] | None:
    """The raw Chromaprint items of a decoded file, as signed 32-bit integers (fingerprints.chromaprint
    is int[]), or None when the audio is too short to fingerprint."""
    r = subprocess.run(  # noqa: S603 - fixed program, arguments built here
        [  # noqa: S607
            "fpcalc",
            "-format",
            "f32le",
            "-rate",
            str(SAMPLE_RATE),
            "-channels",
            "2",
            "-length",
            str(MAX_SECONDS),
            "-raw",
            "-signed",
            "-json",
            str(decoded),
        ],
        capture_output=True,
        check=False,
        timeout=60,
    )
    if r.returncode != 0:
        if EMPTY in r.stderr.decode(errors="replace") + r.stdout.decode(errors="replace"):
            return None
        raise FingerprintFailed(r.stderr.decode(errors="replace")[-500:])
    try:
        items = json.loads(r.stdout)["fingerprint"]
    except (ValueError, KeyError, TypeError) as e:
        raise FingerprintFailed(f"unreadable fpcalc output: {r.stdout[:200]!r}") from e
    if not isinstance(items, list) or not all(isinstance(x, int) and -(2**31) <= x < 2**31 for x in items):
        raise FingerprintFailed("fpcalc gave items that are not signed 32-bit integers")
    return items or None
