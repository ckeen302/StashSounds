"""Duplicate screening (ticket 114): fpcalc fingerprints of the decoded audio, the similarity measure and
the threshold on the fixtures, and screen()'s decisions against candidates from the database."""

from __future__ import annotations

import hashlib
import itertools
import json
import subprocess
import uuid
from pathlib import Path
from typing import Any

import pytest

from stash_worker.audio.ffmpeg import decode, sniff
from stash_worker.audio.fingerprint import fingerprint
from stash_worker.contracts import REPO_ROOT, limits
from stash_worker.screen import DURATION_RATIO, duration_window, screen, sha256_file, similarity

FIXTURES = REPO_ROOT / "fixtures"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())["fixtures"]
LOOPS = [f for f in MANIFEST if f["path"].startswith("generated/loops/")]
DUPLICATES = [f for f in MANIFEST if f["path"].startswith("generated/duplicates/")]
THRESHOLD = limits()["worker"]["fingerprintThreshold"]
INT32 = range(-(2**31), 2**31)


def decoded(path: Path, out: Path) -> Path:
    fmt = sniff(path)
    assert fmt is not None
    return decode(path, fmt, out, 60_000).path


@pytest.fixture(scope="module")
def prints(tmp_path_factory) -> dict[str, list[int]]:
    tmp = tmp_path_factory.mktemp("fp")
    out: dict[str, list[int]] = {}
    for f in LOOPS + DUPLICATES:
        fp = fingerprint(decoded(FIXTURES / f["path"], tmp / "d.f32"))
        assert fp is not None, f["path"]
        out[f["path"]] = fp
    return out


def ffmpeg(src: Path, dest: Path, *args: str) -> Path:
    subprocess.run(  # noqa: S603
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(src), *args, str(dest)],  # noqa: S607
        check=True,
    )
    return dest


# -- fingerprints ---------------------------------------------------------------------------------


def test_every_loop_fixture_has_a_signed_32_bit_fingerprint(prints):
    for path, fp in prints.items():
        assert len(fp) >= 4, path
        assert all(isinstance(x, int) and x in INT32 for x in fp), path
    assert any(x < 0 for fp in prints.values() for x in fp)  # -signed: values above 2^31 wrap


def test_a_fingerprint_is_the_same_every_time(tmp_path: Path, prints):
    path = "generated/loops/dusty_soul_90_Dmin.wav"
    assert fingerprint(decoded(FIXTURES / path, tmp_path / "d.f32")) == prints[path]


def test_audio_too_short_to_fingerprint_gives_none(tmp_path: Path):
    src = FIXTURES / "generated/loops/midnight_keys_140bpm_Am.wav"
    short = ffmpeg(src, tmp_path / "short.wav", "-t", "1.5")
    assert fingerprint(decoded(short, tmp_path / "d.f32")) is None


def test_fpcalc_reads_only_the_decoded_raw_file(tmp_path: Path):
    # fpcalc never parses the upload: the child hands it its own f32 decode with the format forced. A
    # WAV header fed as raw f32 is just noise at the start, not a container fpcalc would probe.
    raw = decoded(FIXTURES / "generated/loops/midnight_keys_140bpm_Am.wav", tmp_path / "d.f32")
    assert raw.stat().st_size % 8 == 0
    assert fingerprint(raw) is not None


# -- similarity and the threshold ------------------------------------------------------------------


def test_identical_fingerprints_are_1_and_complements_are_0():
    a = [1, -2, 3, 2**31 - 1, -(2**31), 0, 77, 1234567]
    assert similarity(a, a) == 1.0
    assert similarity(a, [~x for x in a]) == 0.0


@pytest.mark.parametrize("dup", DUPLICATES, ids=lambda f: Path(f["path"]).name)
def test_each_duplicate_fixture_is_over_the_threshold_against_its_original(prints, dup: dict[str, Any]):
    s = similarity(prints[dup["path"]], prints[dup["expect"]["duplicateOf"]])
    assert s > THRESHOLD
    assert s >= 0.99  # measured 0.994 to 1.000; see handoff 114


def test_no_two_different_loop_fixtures_are_near_the_threshold(prints):
    worst = max(similarity(prints[a["path"]], prints[b["path"]]) for a, b in itertools.combinations(LOOPS, 2))
    assert worst < THRESHOLD - 0.1  # measured 0.781 (drill_lead against midnight_keys); see handoff 114


@pytest.mark.parametrize(
    "variant",
    [
        ("mp3_64k.mp3", ["-c:a", "libmp3lame", "-b:a", "64k"]),
        ("quieter.wav", ["-af", "volume=-6dB"]),
        ("end_trimmed.wav", ["-t", "6.36"]),
        ("start_trimmed.wav", ["-ss", "0.5"]),
    ],
    ids=lambda v: v[0],
)
def test_degraded_copies_made_here_are_over_the_threshold(tmp_path: Path, prints, variant):
    name, args = variant
    original = "generated/loops/midnight_keys_140bpm_Am.wav"
    copy = ffmpeg(FIXTURES / original, tmp_path / name, *args)
    fp = fingerprint(decoded(copy, tmp_path / "d.f32"))
    assert fp is not None
    assert similarity(fp, prints[original]) > THRESHOLD


def test_overlap_is_measured_over_the_shorter_fingerprint():
    # The best alignment must cover 90% of the shorter fingerprint: a contained copy matches, but a few
    # matching items at one end of an otherwise different fingerprint do not.
    long_ = list(range(40))
    assert similarity(long_[10:14], long_) == 1.0  # contained: a real trimmed copy
    assert similarity([5, 6, 7, 8] + [~x for x in range(9, 40)], long_) < 0.2


def test_the_duration_window():
    assert DURATION_RATIO == 0.75
    assert duration_window(6857) == (5143, 9142)
    lo, hi = duration_window(6857)
    assert lo <= 6610 <= hi  # the trimmed fixture against its original, both ways
    assert duration_window(6610)[0] <= 6857 <= duration_window(6610)[1]


def test_sha256_of_a_file(tmp_path: Path):
    p = tmp_path / "f"
    p.write_bytes(b"x" * 100_000)
    assert sha256_file(p) == hashlib.sha256(b"x" * 100_000).hexdigest()


# -- screen(): the decision ------------------------------------------------------------------------

OWNER, OTHER = str(uuid.uuid4()), str(uuid.uuid4())
FP = [(i * 2654435761) % 2**32 - 2**31 for i in range(40)]


class Lookups:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = rows
        self.calls: list[tuple[Any, ...]] = []

    def duplicate_candidates(self, job_id, attempt, file_id, sha256, min_ms, max_ms):
        self.calls.append((job_id, attempt, file_id, sha256, min_ms, max_ms))
        return self.rows


def staged(tmp_path: Path) -> tuple[dict[str, Any], Path]:
    file_id = str(uuid.uuid4())
    (tmp_path / file_id).write_bytes(b"audio bytes")
    job_input = {
        "jobId": str(uuid.uuid4()),
        "attempt": 2,
        "itemId": str(uuid.uuid4()),
        "ownerId": OWNER,
        "type": "loop",
        "files": [{"id": file_id, "role": "original", "path": f"{OWNER}/x/original.wav"}],
    }
    return job_input, tmp_path


def result(fp: list[int] | None = FP, duration_ms: int = 6857) -> dict[str, Any]:
    prints = (
        [] if fp is None else [{"filePath": f"{OWNER}/x/original.wav", "durationMs": duration_ms, "chromaprint": fp}]
    )
    return {"type": "loop", "durationMs": duration_ms, "fingerprints": prints, "flag": None}


def row(match: str, owner: str, fp: list[int] | None = None, duration_ms: int | None = None) -> dict[str, Any]:
    return {
        "match": match,
        "item_id": str(uuid.uuid4()),
        "owner_id": owner,
        "duration_ms": duration_ms,
        "chromaprint": fp,
    }


def test_screen_looks_up_the_staged_originals_sha_and_the_duration_window(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    q = Lookups([])
    out = screen(q, job_input, result(), in_dir)
    assert out["flag"] is None
    f = job_input["files"][0]
    assert q.calls == [
        (job_input["jobId"], 2, f["id"], hashlib.sha256(b"audio bytes").hexdigest(), *duration_window(6857))
    ]


def test_without_a_fingerprint_only_the_sha_is_looked_up(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    q = Lookups([])
    screen(q, job_input, result(fp=None), in_dir)
    assert q.calls[0][4:] == (None, None)


def test_an_exact_copy_of_another_users_original_is_duplicate_exact(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    out = screen(Lookups([row("exact", OTHER)]), job_input, result(), in_dir)
    assert out["flag"]["reason"] == "duplicate_exact"
    assert "your own" not in out["flag"]["detail"]


def test_the_uploaders_own_file_is_flagged_too_and_says_so(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    out = screen(Lookups([row("exact", OWNER)]), job_input, result(), in_dir)
    assert out["flag"]["reason"] == "duplicate_exact"
    assert "your own" in out["flag"]["detail"]


def test_a_fingerprint_over_the_threshold_is_duplicate_fingerprint(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    near = list(FP)
    near[0] ^= 0xFF  # 8 of 1280 bits differ
    out = screen(Lookups([row("fingerprint", OTHER, near, 6700)]), job_input, result(), in_dir)
    assert out["flag"]["reason"] == "duplicate_fingerprint"
    assert len(out["flag"]["detail"]) <= 500


def test_a_fingerprint_under_the_threshold_is_not_flagged(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    far = [x ^ 0x0F0F0F0F for x in FP]  # half the bits
    assert screen(Lookups([row("fingerprint", OTHER, far, 6857)]), job_input, result(), in_dir)["flag"] is None


def test_exact_wins_over_fingerprint_and_another_user_over_the_uploader(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    rows = [row("fingerprint", OTHER, FP, 6857), row("exact", OWNER), row("exact", OTHER)]
    out = screen(Lookups(rows), job_input, result(), in_dir)
    assert out["flag"]["reason"] == "duplicate_exact"
    assert "your own" not in out["flag"]["detail"]
    rows = [row("fingerprint", OWNER, FP, 6857), row("fingerprint", OTHER, FP, 6857)]
    out = screen(Lookups(rows), job_input, result(), in_dir)
    assert (out["flag"]["reason"], "your own" in out["flag"]["detail"]) == ("duplicate_fingerprint", False)


def test_screen_leaves_an_existing_flag_and_does_not_change_the_input(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    r = result()
    out = screen(Lookups([row("exact", OTHER)]), job_input, r, in_dir)
    assert r["flag"] is None and out is not r
    r["flag"] = {"reason": "pack_name_blocklist"}
    assert screen(Lookups([row("exact", OTHER)]), job_input, r, in_dir)["flag"] == {"reason": "pack_name_blocklist"}


def test_a_fingerprint_for_a_file_that_is_not_the_original_is_refused(tmp_path: Path):
    job_input, in_dir = staged(tmp_path)
    r = result()
    r["fingerprints"][0]["filePath"] = "someone/else/original.wav"
    with pytest.raises(ValueError, match="not this job's original"):
        screen(Lookups([]), job_input, r, in_dir)
