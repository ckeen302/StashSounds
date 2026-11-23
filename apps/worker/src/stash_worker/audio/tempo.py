"""Tempo (build spec: Worker jobs, Loop, BPM; ticket 113). Three sources, in order of trust:

1. A whole number in the file name from limits.bpm.fileNameMin to fileNameMax.
2. Duration: the tempos at which the loop is a whole number of 4/4 bars (1, 2, 4, 8 or 16).
3. Onset: a spectral-flux onset envelope, autocorrelated, which ranks the duration candidates and gives
   a tempo of its own to check them against.

`bpmAgreed` is true only when the sources that are present agree.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np

from stash_worker.contracts import limits

BARS = (1, 2, 4, 8, 16)
BEATS_PER_BAR = 4
NAME_FITS = 0.01  # a name within 1% of a whole-bar tempo is that tempo
ONSET_AGREES = 0.02  # an onset tempo within 2% of a candidate agrees with it
ONSET_RANGE = (60.0, 200.0)  # the free onset search, the tempos hip-hop loops are written at
ONSET_STEP = 0.25
ONSET_WINDOW = 2048
ONSET_HOP = 512  # 86 envelope frames a second at 44.1 kHz
LAG_MULTIPLES = (1, 2, 4)  # a beat lag is scored with the lags of 2 and 4 beats
PRIOR_BPM = 120.0  # orders candidates when the audio says nothing (silence)
MAX_CANDIDATES = 8  # contracts detectionSchema.bpmCandidates

_NUMBER = re.compile(r"(?<![\d.])(\d{2,3})(?!\d)")
_BPM_WORD = re.compile(r"bpm", re.IGNORECASE)


@dataclass(frozen=True)
class Tempo:
    bpm: float | None
    source: str | None  # contracts bpmSourceSchema: filename, duration or onset here
    agreed: bool
    candidates: list[float]  # whole-bar tempos, best first
    bars: int | None


def bpm_from_name(file_name: str | None) -> int | None:
    """A number in range next to "bpm" ("140bpm", "bpm140", "140 BPM"), otherwise the last one in range."""
    if not file_name:
        return None
    lim = limits()["bpm"]
    stem = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
    near_word, plain = [], []
    for m in _NUMBER.finditer(stem):
        value = int(m.group(1))
        if not lim["fileNameMin"] <= value <= lim["fileNameMax"]:
            continue
        before, after = stem[max(0, m.start() - 4) : m.start()], stem[m.end() : m.end() + 4]
        tagged = _BPM_WORD.match(after.lstrip(" _-")) or _BPM_WORD.search(before.rstrip(" _-")[-3:])
        (near_word if tagged else plain).append(value)
    return (near_word or plain or [None])[-1]


def duration_candidates(frames: int, sample_rate: int) -> list[tuple[float, int]]:
    """(tempo, bars) for each whole number of 4/4 bars that gives a tempo within limits.bpm."""
    lim = limits()["bpm"]
    seconds = frames / sample_rate
    out = []
    for bars in BARS:
        bpm = round(bars * BEATS_PER_BAR * 60 / seconds, 2)
        if lim["min"] <= bpm <= lim["max"]:
            out.append((bpm, bars))
    return out


def onset_envelope(mono: np.ndarray, sample_rate: int) -> tuple[np.ndarray, float]:
    """Positive spectral flux of the log-magnitude STFT, one value per hop, and its frame rate."""
    x = np.asarray(mono, dtype=np.float32)
    if len(x) < ONSET_WINDOW:
        x = np.pad(x, (0, ONSET_WINDOW - len(x)))
    frames = np.lib.stride_tricks.sliding_window_view(x, ONSET_WINDOW)[::ONSET_HOP]
    window = np.hanning(ONSET_WINDOW).astype(np.float32)
    flux = np.zeros(len(frames))  # the first frame has nothing before it: 0
    previous = None
    for start in range(0, len(frames), 256):  # in blocks, so a 60 s loop stays a few MB
        mag = np.log1p(100 * np.abs(np.fft.rfft(frames[start : start + 256] * window, axis=1)))
        stacked = mag if previous is None else np.vstack([previous, mag])
        diff = np.maximum(np.diff(stacked, axis=0), 0).sum(axis=1)
        first = start + 1 if previous is None else start
        flux[first : first + len(diff)] = diff
        previous = mag[-1:]
    return flux - flux.mean(), sample_rate / ONSET_HOP


def _autocorrelation(envelope: np.ndarray) -> np.ndarray | None:
    n = len(envelope)
    if n < 4 or float(np.dot(envelope, envelope)) <= 1e-9:
        return None
    spectrum = np.fft.rfft(envelope, 2 * n)
    ac = np.fft.irfft(spectrum * np.conj(spectrum))[:n]
    return ac / ac[0]


def _score(ac: np.ndarray, fps: float, bpm: float) -> float:
    lag = 60 * fps / bpm
    total = 0.0
    for m in LAG_MULTIPLES:
        at = lag * m
        i = int(at)
        if i + 1 >= len(ac):
            break
        total += float(ac[i] + (ac[i + 1] - ac[i]) * (at - i))
    return total


def onset_tempo(ac: np.ndarray, fps: float) -> float:
    grid = np.arange(ONSET_RANGE[0], ONSET_RANGE[1] + ONSET_STEP / 2, ONSET_STEP)
    scores = [_score(ac, fps, b) for b in grid]
    return float(grid[int(np.argmax(scores))])


def _close(a: float, b: float, tolerance: float) -> bool:
    return abs(a - b) <= tolerance * b


def detect_bpm(mono: np.ndarray, sample_rate: int, file_name: str | None) -> Tempo:
    fits = duration_candidates(len(mono), sample_rate)
    ac = _autocorrelation(onset_envelope(mono, sample_rate)[0])
    fps = sample_rate / ONSET_HOP
    if ac is not None:
        ranked = sorted(fits, key=lambda c: _score(ac, fps, c[0]), reverse=True)
        heard: float | None = onset_tempo(ac, fps)
    else:  # silence: no onsets, so order by distance from a typical tempo
        ranked = sorted(fits, key=lambda c: abs(math.log2(c[0] / PRIOR_BPM)))
        heard = None
    candidates = [bpm for bpm, _ in ranked][:MAX_CANDIDATES]
    best = ranked[0] if ranked else None

    named = bpm_from_name(file_name)
    if named is not None:
        bars = next((b for bpm, b in fits if _close(named, bpm, NAME_FITS)), None)
        agreed = (
            best is not None
            and _close(named, best[0], NAME_FITS)
            and heard is not None
            and _close(heard, named, ONSET_AGREES)
        )
        return Tempo(named, "filename", agreed, candidates, bars)

    if best is not None and heard is not None and _close(heard, best[0], ONSET_AGREES):
        return Tempo(_tidy(best[0]), "duration", True, candidates, best[1])
    if heard is not None:  # not whole bars: what the onsets say
        return Tempo(float(round(heard)), "onset", False, candidates, None)
    if best is not None:
        return Tempo(_tidy(best[0]), "duration", False, candidates, best[1])
    return Tempo(None, None, False, candidates, None)


def _tidy(bpm: float) -> float:
    """A whole-bar tempo within 0.01 of a whole number is that number (142.0, not 141.9997)."""
    return float(round(bpm)) if abs(bpm - round(bpm)) < 0.01 else bpm
