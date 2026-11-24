"""BPM and key detection (ticket 113): the file-name parsers, the key parser mirrored from the contracts,
chroma against the 24 key profiles, and duration plus onset tempo, on the fixtures and on synthetic audio."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from stash_worker.audio.key import detect_key, format_key, key_from_chroma, key_from_name, parse_key, pitch_chroma
from stash_worker.audio.tempo import bpm_from_name, detect_bpm, duration_candidates
from stash_worker.contracts import REPO_ROOT, limits

SR = 44100
FIXTURES = REPO_ROOT / "fixtures"
MANIFEST = json.loads((FIXTURES / "manifest.json").read_text())["fixtures"]
LOOPS = [f for f in MANIFEST if f["type"] == "loop" and not f["hostile"] and "bpm" in f["expect"]]
CONTRACT_TESTS = REPO_ROOT / "packages/contracts/test/contracts.test.ts"


def mono(path: Path) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "x.f32"
        subprocess.run(  # noqa: S603
            ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "2", "-ar", str(SR), "-f", "f32le", str(out)],  # noqa: S607
            check=True,
        )
        return np.fromfile(out, dtype="<f4").reshape(-1, 2).mean(axis=1)


def name_of(f: dict[str, Any]) -> str:
    return Path(f["path"]).name


# -- the key parser, mirroring packages/contracts parseKey case for case ------------------------------

PARSES = [
    ("F#m", {"root": 6, "mode": "minor"}),
    ("F# minor", {"root": 6, "mode": "minor"}),
    ("Fsharpmin", {"root": 6, "mode": "minor"}),
    ("Cmin", {"root": 0, "mode": "minor"}),
    ("Ebmaj", {"root": 3, "mode": "major"}),
    ("a min", {"root": 9, "mode": "minor"}),
    ("G", {"root": 7, "mode": "major"}),
    ("Bb", {"root": 10, "mode": "major"}),
]
REJECTS = ["H", "", "C##", "minor", "Cmaj7"]


@pytest.mark.parametrize(("text", "expected"), PARSES)
def test_parse_key_parses(text: str, expected: dict):
    assert parse_key(text) == expected


@pytest.mark.parametrize("text", REJECTS)
def test_parse_key_rejects(text: str):
    assert parse_key(text) is None


def test_parse_key_round_trips_every_key():
    for root in range(12):
        for mode in ("major", "minor"):
            assert parse_key(format_key({"root": root, "mode": mode})) == {"root": root, "mode": mode}


def test_the_cases_are_the_contracts_cases():
    # Read the cases out of the TypeScript test, so a case added there fails here until it is mirrored.
    src = CONTRACT_TESTS.read_text()
    block = src[src.index('describe("musical keys"') :]
    block = block[: block.index("\n});")]
    parses = re.findall(r'\["([^"]*)", \{ root: (\d+), mode: "(major|minor)" \}\]', block)
    assert [(t, {"root": int(r), "mode": m}) for t, r, m in parses] == PARSES
    rejects = re.search(r"it\.each\(\[([^\]]*)\]\)\(\"rejects", block)
    assert rejects is not None
    assert re.findall(r'"([^"]*)"', rejects.group(1)) == REJECTS


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("  F#m  ", {"root": 6, "mode": "minor"}),  # trimmed
        ("f♯ MINOR", {"root": 6, "mode": "minor"}),  # unicode sharp, any case
        ("B♭maj", {"root": 10, "mode": "major"}),
        ("Gm", {"root": 7, "mode": "minor"}),
        ("Cb", {"root": 11, "mode": "major"}),
        ("B#", {"root": 0, "mode": "major"}),
        ("Am\n", {"root": 9, "mode": "minor"}),  # trailing whitespace is trimmed, as in JavaScript
        ("Fsharpsharp", None),  # only the first "sharp" becomes "#", as String.replace does
        ("Am7", None),
    ],
)
def test_parse_key_edge_cases_match_the_javascript_semantics(text: str, expected: dict | None):
    assert parse_key(text) == expected


# -- keys and tempos in file names ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("midnight_keys_140bpm_Am.wav", (9, "minor")),
        ("dusty_soul_90_Dmin.wav", (2, "minor")),
        ("trap_bells_150_F#m.mp3", (6, "minor")),
        ("rnb_pad_72bpm_Ebmaj.aiff", (3, "major")),
        ("Dark Keys - F# minor - 140.wav", (6, "minor")),
        ("G_funk_loop_Am.wav", (9, "minor")),  # the last key in the name wins
        ("loop 140 C#m.wav", (1, "minor")),
        ("bells_150F#m.wav", (6, "minor")),  # glued to the tempo
        ("dusty_soul_dmin.wav", (2, "minor")),
        ("drill_lead_142.flac", None),
        ("i_am_a_loop.wav", None),  # "am" and "a" are words, not keys
        ("em_be_bb_loop.wav", None),
        ("cmaj7_chords.wav", None),
        ("", None),
    ],
)
def test_keys_in_file_names(name: str, expected: tuple[int, str] | None):
    got = key_from_name(name)
    assert (None if got is None else (got["root"], got["mode"])) == expected


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("midnight_keys_140bpm_Am.wav", 140),
        ("dusty_soul_90_Dmin.wav", 90),
        ("drill_lead_142.flac", 142),
        ("rnb_pad_72bpm_Ebmaj.aiff", 72),
        ("bpm140_loop.wav", 140),
        ("loop_140 BPM.wav", 140),
        ("808_bassline_140_Am.wav", 140),  # 808 is out of range
        ("vol_2_loop_95_take_120bpm.wav", 120),  # next to "bpm" beats the rest
        ("take_95_then_120.wav", 120),  # otherwise the last
        ("loop_59.wav", None),
        ("loop_201.wav", None),
        ("loop_2024_mix.wav", None),
        ("loop_1400.wav", None),
        ("trap_bells_F#m.mp3", None),
    ],
)
def test_bpm_in_file_names(name: str, expected: int | None):
    assert bpm_from_name(name) == expected


def test_file_name_bpm_range_comes_from_limits():
    b = limits()["bpm"]
    assert bpm_from_name(f"x_{b['fileNameMin']}.wav") == b["fileNameMin"]
    assert bpm_from_name(f"x_{b['fileNameMax']}.wav") == b["fileNameMax"]
    assert bpm_from_name(f"x_{b['fileNameMin'] - 1}.wav") is None
    assert bpm_from_name(f"x_{b['fileNameMax'] + 1}.wav") is None


def test_duration_candidates_are_whole_bars_of_four_four_within_limits():
    frames = round(2 * 4 * 60 / 142 * SR)  # drill_lead_142: 2 bars at 142
    got = duration_candidates(frames, SR)
    assert [(bpm, bars) for bpm, bars in got] == [(71.0, 1), (142.0, 2), (284.0, 4)]
    b = limits()["bpm"]
    assert all(b["min"] <= bpm <= b["max"] for bpm, _ in got)
    assert len(got) <= 8


# -- chroma and the 24 profiles ------------------------------------------------------------------------


def triads(root: int, minor: bool, seconds: float = 4.0) -> np.ndarray:
    """i - iv - v - i in the key (natural minor or major), sine tones, one chord a second."""
    t = np.arange(round(seconds * SR)) / SR
    third = 3 if minor else 4
    out = np.zeros_like(t)
    for i, degree in enumerate([0, 5, 7, 0]):
        sel = (t >= i * seconds / 4) & (t < (i + 1) * seconds / 4)
        r = 48 + root + degree
        quality = third if degree == 0 else (3 if minor else 4)
        for m in (r, r + quality, r + 7):
            out[sel] += np.sin(2 * np.pi * 440 * 2 ** ((m - 69) / 12) * t[sel]) / 3
    return (out * 0.3).astype(np.float32)


@pytest.mark.parametrize("mode", ["major", "minor"])
@pytest.mark.parametrize("root", range(12))
def test_chroma_finds_every_key_of_synthetic_triads(root: int, mode: str):
    key, confidence = key_from_chroma(pitch_chroma(triads(root, mode == "minor"), SR))
    assert key == {"root": root, "mode": mode}
    assert 0 < confidence <= 1


def test_chroma_ignores_a_kick_below_c2():
    # A loud 55 Hz kick on every beat (A1) must not pull a C major loop toward A.
    x = triads(0, minor=False)
    t = np.arange(len(x)) / SR
    tb = t % 0.5
    kick = (np.sin(2 * np.pi * 55 * tb) * np.exp(-tb * 18)).astype(np.float32)
    key, _ = key_from_chroma(pitch_chroma(x + kick, SR))
    assert key == {"root": 0, "mode": "major"}


def test_a_silent_signal_has_no_chroma_key():
    assert key_from_chroma(pitch_chroma(np.zeros(SR * 2, dtype=np.float32), SR)) is None


# -- the fixtures ----------------------------------------------------------------------------------------


@pytest.fixture(scope="module")
def decoded() -> dict[str, np.ndarray]:
    return {f["path"]: mono(FIXTURES / f["path"]) for f in LOOPS}


@pytest.mark.parametrize("fixture", LOOPS, ids=name_of)
def test_every_loop_fixture_gets_its_manifest_key(decoded, fixture: dict[str, Any]):
    key, source, confidence = detect_key(decoded[fixture["path"]], SR, name_of(fixture))
    assert key == fixture["expect"]["key"]
    assert source == fixture["expect"]["keySource"]
    if source == "chroma":
        assert confidence is not None and 0 < confidence <= 1
    else:
        assert confidence is None


@pytest.mark.parametrize("fixture", LOOPS, ids=name_of)
def test_without_a_name_chroma_finds_every_loop_fixtures_key(decoded, fixture: dict[str, Any]):
    # The fixtures' chords are diatonic since decision 0017, so chroma alone agrees with every name.
    key, source, confidence = detect_key(decoded[fixture["path"]], SR, "untitled.wav")
    assert (key, source) == (fixture["expect"]["key"], "chroma")
    assert confidence is not None and 0 < confidence <= 1


def test_drill_lead_gets_g_minor_from_chroma(decoded):
    [f] = [f for f in LOOPS if name_of(f) == "drill_lead_142.flac"]
    key, source, confidence = detect_key(decoded[f["path"]], SR, name_of(f))
    assert (key, source) == ({"root": 7, "mode": "minor"}, "chroma")
    assert confidence is not None and confidence >= 0.05


@pytest.mark.parametrize("fixture", LOOPS, ids=name_of)
def test_every_loop_fixture_gets_its_manifest_bpm_from_its_name_and_the_sources_agree(decoded, fixture: dict[str, Any]):
    t = detect_bpm(decoded[fixture["path"]], SR, name_of(fixture))
    assert t.bpm == fixture["expect"]["bpm"]
    assert t.source == "filename"
    assert t.agreed is True
    assert t.bars == fixture["expect"]["bars"]
    assert t.candidates[0] == fixture["expect"]["bpm"]
    assert 1 <= len(t.candidates) <= 8


@pytest.mark.parametrize("fixture", LOOPS, ids=name_of)
def test_without_a_name_duration_and_onset_still_find_the_manifest_bpm(decoded, fixture: dict[str, Any]):
    t = detect_bpm(decoded[fixture["path"]], SR, "untitled.wav")
    assert (t.bpm, t.source, t.agreed, t.bars) == (
        fixture["expect"]["bpm"],
        "duration",
        True,
        fixture["expect"]["bars"],
    )


def test_a_name_the_audio_disagrees_with_is_kept_but_not_agreed(decoded):
    [f] = [f for f in LOOPS if name_of(f) == "midnight_keys_140bpm_Am.wav"]
    t = detect_bpm(decoded[f["path"]], SR, "midnight_keys_97bpm.wav")
    assert (t.bpm, t.source, t.agreed, t.bars) == (97, "filename", False, None)


def test_a_loop_that_is_not_whole_bars_falls_back_to_the_onset_tempo():
    # The trimmed duplicate is the 140 BPM loop with 0.25 s cut off the front: no bar count fits.
    t = detect_bpm(mono(FIXTURES / "generated/duplicates/midnight_keys_trimmed.wav"), SR, "midnight_keys_trimmed.wav")
    assert t.source == "onset"
    assert t.agreed is False
    assert t.bars is None
    assert t.bpm is not None and abs(t.bpm - 140) <= 1


def test_silence_has_no_onset_tempo_and_is_not_agreed():
    t = detect_bpm(np.zeros(round(2 * 4 * 60 / 120 * SR), dtype=np.float32), SR, "pad.wav")
    assert t.agreed is False
    assert t.source == "duration"
    assert t.bpm in t.candidates


def test_detection_runs_within_one_thread(tmp_path: Path):
    # numpy's OpenBLAS starts a thread per core on import unless told not to; the child counts toward
    # RLIMIT_NPROC (see test_isolation). The sandbox passes the single-thread settings to the child.
    from stash_worker.sandbox import _child_env

    env = _child_env(tmp_path)
    assert env["OPENBLAS_NUM_THREADS"] == "1"
    assert env["OMP_NUM_THREADS"] == "1"
    code = "import numpy, os; print(len(os.listdir('/proc/self/task')))"
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True)  # noqa: S603
    assert int(out.stdout) == 1
