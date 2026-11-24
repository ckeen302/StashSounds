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

import stash_worker.audio.tempo as tempo
from stash_worker.audio.key import (
    MAJOR_PROFILE,
    MINOR_PROFILE,
    detect_key,
    format_key,
    key_from_chroma,
    key_from_name,
    parse_key,
    pitch_chroma,
)
from stash_worker.audio.tempo import _tidy, bpm_from_name, detect_bpm, duration_candidates
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
        ("\x1cAm", None),  # U+001C is not white space to JavaScript's trim, though Python's strip() drops it
        ("\u00a0Am\u3000", {"root": 9, "mode": "minor"}),  # NBSP and ideographic space are
        ("\u0085Am", None),  # NEL is not JavaScript white space either
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


# -- PR #13 review: confidence is the margin --------------------------------------------------------------

KEY_CONFIDENCE_MIN = limits()["bpm"]["keyConfidenceMin"]


def pearson(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum()))


def margin(chroma: np.ndarray) -> tuple[tuple[int, str], float]:
    """The 24 correlations written out again here, and the best one's lead over the second."""
    scores = sorted(
        (
            (pearson(chroma, np.roll(p, r)), (r, mode))
            for mode, p in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE))
            for r in range(12)
        ),
        reverse=True,
    )
    return scores[0][1], scores[0][0] - scores[1][0]


@pytest.mark.parametrize("seed", range(6))
def test_key_confidence_is_exactly_the_best_correlation_minus_the_second(seed: int):
    chroma = np.random.default_rng(seed).random(12)
    (root, mode), expected = margin(chroma)
    key, confidence = key_from_chroma(chroma)
    assert key == {"root": root, "mode": mode}
    assert confidence == round(expected, 4)


def test_a_chroma_that_is_a_key_profile_has_correlation_1_and_the_runner_ups_margin():
    d_major = np.roll(MAJOR_PROFILE, 2)
    key, confidence = key_from_chroma(d_major)
    assert key == {"root": 2, "mode": "major"}
    second = sorted(pearson(d_major, np.roll(p, r)) for p in (MAJOR_PROFILE, MINOR_PROFILE) for r in range(12))[-2]
    assert confidence == round(1 - second, 4)
    assert confidence > 0.3  # measured 0.3504


def test_a_blend_of_relative_major_and_minor_is_below_the_confidence_minimum():
    blend = MAJOR_PROFILE / MAJOR_PROFILE.max() + np.roll(MINOR_PROFILE, 9) / MINOR_PROFILE.max()  # C and Am
    key, confidence = key_from_chroma(blend)
    assert key["root"] in (0, 9)
    assert confidence < KEY_CONFIDENCE_MIN  # measured 0.0166


def test_a_clear_progression_is_above_the_confidence_minimum():
    # i - iv - v - i in C major and A minor. A lone tonic triad is not enough: C-E-G is also most of
    # A minor and E minor, and scores 0.0735.
    for root, minor in ((0, False), (9, True)):
        _, confidence = key_from_chroma(pitch_chroma(triads(root, minor), SR))
        assert confidence > KEY_CONFIDENCE_MIN  # measured 0.1724 and 0.2759
    lone = np.zeros(12)
    lone[[0, 4, 7]] = 1
    assert key_from_chroma(lone)[1] < KEY_CONFIDENCE_MIN


def test_a_40_hz_kick_below_c2_changes_neither_the_key_nor_its_confidence():
    x = triads(0, minor=False)
    tb = (np.arange(len(x)) / SR) % 0.5
    kick = (2 * np.sin(2 * np.pi * 40 * tb) * np.exp(-tb * 18)).astype(np.float32)
    plain, with_kick = key_from_chroma(pitch_chroma(x, SR)), key_from_chroma(pitch_chroma(x + kick, SR))
    assert with_kick[0] == plain[0] == {"root": 0, "mode": "major"}
    assert abs(with_kick[1] - plain[1]) < 0.01


def test_nan_and_inf_samples_never_give_a_non_finite_key_confidence():
    x = triads(9, minor=True)
    x[100], x[5000] = np.nan, np.inf
    key, source, confidence = detect_key(x, SR, "untitled.wav")
    assert (key, source) == ({"root": 9, "mode": "minor"}, "chroma")
    assert confidence is not None and np.isfinite(confidence)
    assert detect_key(np.full(SR * 2, np.nan, dtype=np.float32), SR, "untitled.wav") == (None, None, None)


# -- PR #13 review: tempo octaves on hip-hop drums -------------------------------------------------------


def hit(rng: np.random.Generator, ms: float, decay_ms: float, tone_hz: float | None = None) -> np.ndarray:
    k = np.arange(int(SR * ms / 1000))
    env = np.exp(-k / (SR * decay_ms / 1000))
    if tone_hz is None:
        return (rng.standard_normal(len(k)) * env).astype(np.float32)
    return (np.sin(2 * np.pi * tone_hz * k / SR) * env).astype(np.float32)


def drums(bpm: float, bars: int, *, kick: bool = True, snare: bool = True, hat_offbeat: float = 0.3) -> np.ndarray:
    """Synthetic drums in 4/4: kick on 1 and 3, snare on 2 and 4, eighth-note hats with the off-beat
    hats at `hat_offbeat` of the on-beat level (a boom-bap pattern with all three)."""
    rng = np.random.default_rng(int(bpm * 10 + bars))
    n = round(bars * 4 * 60 / bpm * SR)
    x = np.zeros(n, np.float32)
    beat = 60 / bpm * SR
    hat, k, sn = hit(rng, 30, 5), hit(rng, 200, 60, 55), hit(rng, 120, 30)

    def put(at: float, sound: np.ndarray, level: float) -> None:
        p = int(at)
        e = min(n, p + len(sound))
        x[p:e] += level * sound[: e - p]

    for i in range(bars * 8):
        put(i * beat / 2, hat, 0.5 if i % 2 == 0 else 0.5 * hat_offbeat)
    for b in range(bars * 4):
        if kick and b % 2 == 0:
            put(b * beat, k, 0.9)
        if snare and b % 2 == 1:
            put(b * beat, sn, 0.6)
    return x * 0.5


@pytest.mark.parametrize("bpm", [85, 88, 90, 92, 95])
@pytest.mark.parametrize("bars", [2, 4])
def test_boom_bap_drums_get_their_tempo_not_double(bpm: int, bars: int):
    t = detect_bpm(drums(bpm, bars), SR, "untitled.wav")
    assert (t.bpm, t.source, t.agreed, t.bars) == (bpm, "duration", True, bars)


@pytest.mark.parametrize("bpm", [70, 80, 85, 90, 100])
@pytest.mark.parametrize("bars", [2, 4, 8])
def test_eighth_note_hats_alone_get_the_beat_not_the_hat_rate(bpm: int, bars: int):
    # The review's sweep: before the fix, 16 of 20 of these came out at double tempo, agreed.
    t = detect_bpm(drums(bpm, bars, kick=False, snare=False), SR, "untitled.wav")
    assert (t.bpm, t.source, t.agreed) == (bpm, "duration", True)


def test_a_sixteen_bar_loop():
    t = detect_bpm(drums(140, 16), SR, "untitled.wav")
    assert (t.bpm, t.source, t.agreed, t.bars) == (140, "duration", True, 16)
    assert t.candidates[0] == 140


def test_a_name_that_fits_a_whole_bar_tempo_the_onsets_disagree_with_is_kept_but_not_agreed():
    # Two bars at 90 is also four bars at 180: the name fits a candidate, but the onsets say 90 (M10).
    x = drums(90, 2)
    t = detect_bpm(x, SR, "beat_180bpm.wav")
    assert (t.bpm, t.source, t.agreed, t.bars) == (180, "filename", False, 4)
    assert detect_bpm(x, SR, "beat_90bpm.wav").agreed is True


def test_agreement_is_never_claimed_across_an_octave(monkeypatch):
    # When the onsets hear another octave than the name, the name is kept and not agreed; without a
    # name the value follows the onsets' octave, so whatever is agreed is what the onsets heard.
    x = drums(90, 2)
    monkeypatch.setattr(tempo, "onset_tempo", lambda ac, fps, high_only=False: 180.0)
    t = detect_bpm(x, SR, "beat_90bpm.wav")
    assert (t.bpm, t.source, t.agreed, t.bars) == (90, "filename", False, 2)
    t = detect_bpm(x, SR, "untitled.wav")
    assert (t.bpm, t.agreed) == (180, True)
    monkeypatch.setattr(tempo, "onset_tempo", lambda ac, fps, high_only=False: 91.0 * 1.5)
    t = detect_bpm(x, SR, "untitled.wav")
    assert t.agreed is False  # neither an octave of a candidate nor the candidate itself


@pytest.mark.parametrize("bpm", [70, 85, 90, 100, 128, 140, 150, 160])
@pytest.mark.parametrize("pattern", ["drums", "hats", "kick_snare"])
def test_whatever_is_agreed_is_within_2_percent_of_the_onset_tempo(bpm: int, pattern: str):
    x = {
        "drums": lambda: drums(bpm, 2),
        "hats": lambda: drums(bpm, 2, kick=False, snare=False),
        "kick_snare": lambda: drums(bpm, 2, hat_offbeat=0.0),
    }[pattern]()
    flux, low = tempo._flux(x, SR)
    ac = tempo._autocorrelation(flux - flux.mean())
    heard = tempo.onset_tempo(ac, SR / tempo.ONSET_HOP, high_only=low < tempo.NO_LOW_END)
    for name in ("untitled.wav", f"loop_{bpm}bpm.wav", f"loop_{bpm * 2}bpm.wav"):
        t = detect_bpm(x, SR, name)
        if t.agreed:
            assert heard is not None and abs(t.bpm - heard) <= 0.02 * t.bpm, (name, t, heard)
    if 2 * bpm <= limits()["bpm"]["fileNameMax"]:
        assert detect_bpm(x, SR, f"loop_{bpm * 2}bpm.wav").agreed is (
            heard is not None and abs(heard - 2 * bpm) <= 0.04 * bpm
        )


def test_silence_orders_the_candidates_by_the_prior_and_is_not_agreed():
    t = detect_bpm(np.zeros(round(2 * 4 * 60 / 120 * SR), dtype=np.float32), SR, "untitled.wav")
    assert (t.bpm, t.source, t.agreed, t.bars) == (120, "duration", False, 2)
    assert t.candidates == [120, 60, 240]  # nearest 120 first, in octaves
    t = detect_bpm(np.zeros(round(4 * 60 / 75 * SR), dtype=np.float32), SR, "untitled.wav")
    assert t.candidates == [150, 75, 300]  # log distance: 150 is 0.32 octaves from 120, 75 is 0.68


def test_white_noise_has_no_onset_tempo_and_is_not_agreed():
    x = (np.random.default_rng(0).standard_normal(SR * 4) * 0.1).astype(np.float32)
    assert detect_bpm(x, SR, "untitled.wav").agreed is False


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_nan_or_inf_samples_never_give_non_finite_numbers_or_agreement_from_them(bad: float):
    x = drums(90, 2)
    x[1000] = bad
    t = detect_bpm(x, SR, "untitled.wav")
    assert all(np.isfinite(v) for v in [t.bpm, *t.candidates])
    t = detect_bpm(np.full(SR * 4, bad, dtype=np.float32), SR, "untitled.wav")
    assert t.agreed is False
    assert all(np.isfinite(v) for v in [t.bpm, *t.candidates])


def test_an_empty_signal_has_no_tempo():
    t = detect_bpm(np.zeros(0, dtype=np.float32), SR, "untitled.wav")
    assert (t.bpm, t.source, t.agreed, t.candidates) == (None, None, False, [])


@pytest.mark.parametrize(
    ("raw", "tidy"),
    [(141.9997, 142.0), (142.0049, 142.0), (87.07, 87.07), (141.5, 141.5), (140.0, 140.0), (89.99, 89.99)],
)
def test_tidy_rounds_only_what_is_within_a_hundredth_of_a_whole_number(raw: float, tidy: float):
    assert _tidy(raw) == tidy


def test_hats_alone_have_no_low_end_onsets_and_drums_with_a_kick_do():
    hats_only = tempo._flux(drums(80, 2, kick=False, snare=False), SR)[1]
    with_kick = tempo._flux(drums(80, 2), SR)[1]
    assert hats_only < tempo.NO_LOW_END < with_kick
