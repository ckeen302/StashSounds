"""Tempo (build spec: Worker jobs, Loop, BPM; ticket 113). Three sources, in order of trust:

1. A whole number in the file name from limits.bpm.fileNameMin to fileNameMax.
2. Duration: the tempos at which the loop is a whole number of 4/4 bars (1, 2, 4, 8 or 16).
3. Onset: a spectral-flux onset envelope, autocorrelated (unbiased), which gives a tempo of its own.
   Its octave is chosen by choose_octave: the fastest level with an onset on every beat, one octave
   down when accents say so, with a mild prior toward 70 to 160 BPM (PR #13 review). The whole-bar
   candidate at the onsets' octave is the duration tempo.

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
# log(1 + C |X|): light compression, so a beat played louder than its subdivisions (a kick or an accented
# hat on the beat, quieter eighths between) still stands out in the envelope.
COMPRESSION = 0.1
LOW_HZ = 200.0
# Below this share of onset energy under LOW_HZ, a loop is hats or other high percussion alone: its
# fastest pulse is a subdivision, so accents may step the beat down an octave inside PRIOR_RANGE too.
NO_LOW_END = 0.015  # measured: hats alone 0.007, snare and hats 0.008, a synthetic 55 Hz kick 0.024, fixtures 0.21+
LAG_MULTIPLES = (1, 2, 4)  # a beat lag is scored with the lags of 2 and 4 beats
PRIOR_BPM = 120.0  # orders candidates when the audio says nothing (silence)
PRIOR_RANGE = (70.0, 160.0)  # hip-hop's usual tempos: a mild prior toward them breaks octave near-ties
STEP_DOWN = 0.05  # a slower octave must be this much stronger to be the beat (or within it for the prior)
STEP_CLEAR = 0.1  # ... and this much when the faster octave is already inside PRIOR_RANGE
PERIODIC_SHARE = 0.6  # the fastest level considered has at least this share of the best strength
MIN_PERIODIC = 0.3  # below this strength the onsets have no tempo (white noise: 0.03 to 0.16)
MAX_LAG_SHARE = 0.75  # lags beyond this share of the envelope are too few frames to trust
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
    if frames <= 0 or sample_rate <= 0:
        return []
    seconds = frames / sample_rate
    out = []
    for bars in BARS:
        bpm = round(bars * BEATS_PER_BAR * 60 / seconds, 2)
        if lim["min"] <= bpm <= lim["max"]:
            out.append((bpm, bars))
    return out


def _flux(mono: np.ndarray, sample_rate: int) -> tuple[np.ndarray, float]:
    """Positive spectral flux of the compressed-magnitude STFT, one value per hop, and the share of it
    below LOW_HZ (where a kick or a bass note starts)."""
    x = np.asarray(mono, dtype=np.float32)
    if len(x) < ONSET_WINDOW:
        x = np.pad(x, (0, ONSET_WINDOW - len(x)))
    frames = np.lib.stride_tricks.sliding_window_view(x, ONSET_WINDOW)[::ONSET_HOP]
    window = np.hanning(ONSET_WINDOW).astype(np.float32)
    low = np.fft.rfftfreq(ONSET_WINDOW, 1 / sample_rate) < LOW_HZ
    flux = np.zeros(len(frames))  # the first frame has nothing before it: 0
    low_total = 0.0
    previous = None
    for start in range(0, len(frames), 256):  # in blocks, so a 60 s loop stays a few MB
        mag = np.log1p(COMPRESSION * np.abs(np.fft.rfft(frames[start : start + 256] * window, axis=1)))
        stacked = mag if previous is None else np.vstack([previous, mag])
        rise = np.maximum(np.diff(stacked, axis=0), 0)
        diff = rise.sum(axis=1)
        low_total += float(rise[:, low].sum())
        first = start + 1 if previous is None else start
        flux[first : first + len(diff)] = diff
        previous = mag[-1:]
    total = float(flux.sum())
    return flux, (low_total / total if total > 0 and math.isfinite(total) else 0.0)


def onset_envelope(mono: np.ndarray, sample_rate: int) -> tuple[np.ndarray, float]:
    """Positive spectral flux of the compressed-magnitude STFT, less its mean, and its frame rate."""
    flux, _ = _flux(mono, sample_rate)
    return flux - flux.mean(), sample_rate / ONSET_HOP


def _autocorrelation(envelope: np.ndarray) -> np.ndarray | None:
    """Unbiased autocorrelation (each lag divided by the frames it overlaps), scaled to 1 at lag 0, so
    a long lag is not marked down for being measured over fewer frames. None for silence or a signal
    whose envelope is not finite."""
    n = len(envelope)
    if n < 4 or not np.all(np.isfinite(envelope)) or float(np.dot(envelope, envelope)) <= 1e-9:
        return None
    spectrum = np.fft.rfft(envelope, 2 * n)
    ac = np.fft.irfft(spectrum * np.conj(spectrum))[:n]
    ac = ac * n / (n - np.arange(n))
    if not np.all(np.isfinite(ac)) or ac[0] <= 0:
        return None
    return ac / ac[0]


def _at(ac: np.ndarray, lag: float, spread: bool) -> float | None:
    """The autocorrelation at a lag, interpolated; with `spread`, the peak within a frame of it, since
    an onset falls on one frame or the next depending on where the hop boundaries land."""
    i = int(lag)
    if lag > MAX_LAG_SHARE * len(ac) or i + 1 >= len(ac):
        return None
    if spread:
        return float(ac[max(0, i - 1) : i + 3].max())
    return float(ac[i] + (ac[i + 1] - ac[i]) * (lag - i))


def strength(ac: np.ndarray, fps: float, bpm: float, spread: bool = True) -> float:
    """How periodic the onsets are at this tempo: the mean autocorrelation at 1, 2 and 4 beats, over
    the lags short enough to measure. -inf when even one beat is too long."""
    lag = 60 * fps / bpm
    values = [v for m in LAG_MULTIPLES if (v := _at(ac, lag * m, spread)) is not None]
    return sum(values) / len(values) if values else -math.inf


def _in_prior(bpm: float) -> bool:
    return PRIOR_RANGE[0] * (1 - ONSET_AGREES) <= bpm <= PRIOR_RANGE[1] * (1 + ONSET_AGREES)


def pulse(ac: np.ndarray, fps: float, bpm: float) -> float:
    """The autocorrelation at exactly one beat: is there an onset on every beat of this tempo."""
    v = _at(ac, 60 * fps / bpm, spread=True)
    return -math.inf if v is None else v


def choose_octave(
    tempos: list[float], score: dict[float, float], beats: dict[float, float], *, high_only: bool = False
) -> float | None:
    """The beat among tempos an octave apart, by strength. A slower level contains every lag of a faster
    one, so strength alone cannot tell 90 from 45. The rule:
    - Start at the fastest level with an onset on every one of its beats (`beats`, the autocorrelation
      at one beat). That is often the hats.
    - Step down one octave when the slower level is stronger, because its beats are accented over the
      subdivisions, as on-beat hats are over off-beat ones. The gain needed is STEP_DOWN, or
      STEP_CLEAR when the faster level is already inside PRIOR_RANGE (70 to 160). On a near-tie the
      step is taken when only the slower level is inside the range. With `high_only` (no low-end
      onsets, hats alone), STEP_DOWN applies inside the range as well.
    - Never more than one octave: a kick on 1 and 3 makes the half note stronger still, and that is not
      the beat.
    """
    finite = sorted((t for t in tempos if math.isfinite(score[t])), reverse=True)
    if not finite:
        return None
    top = max(beats[t] for t in finite)
    if top <= 0:
        return None
    level = next(t for t in finite if beats[t] >= PERIODIC_SHARE * top)
    slower = next((t for t in finite if _close(t * 2, level, 0.001)), None)
    if slower is None:
        return level
    gain = score[slower] - score[level]
    if _in_prior(level):
        # Inside the prior both octaves are plausible: a backbeat at 140 is as much "stronger at 70" as
        # accented hats at 70 are, so only a clear gain steps down.
        return slower if gain > (STEP_DOWN if high_only else STEP_CLEAR) else level
    if _in_prior(slower):
        return slower if gain > -STEP_DOWN else level  # a near-tie or better: the prior decides
    return slower if gain > STEP_DOWN else level


def onset_tempo(ac: np.ndarray, fps: float, high_only: bool = False) -> float | None:
    """The tempo the onsets give, from 60 to 200 BPM, without the duration: the strongest tempo on a
    grid, then choose_octave over its octaves in that range. None when nothing is periodic."""
    grid = np.arange(ONSET_RANGE[0], ONSET_RANGE[1] + ONSET_STEP / 2, ONSET_STEP)
    exact = {float(b): strength(ac, fps, float(b), spread=False) for b in grid}
    finite = [b for b, v in exact.items() if math.isfinite(v)]
    if not finite:
        return None
    peak = max(finite, key=lambda b: exact[b])  # the precise tempo: interpolated, not spread
    if exact[peak] < MIN_PERIODIC:  # noise: nothing repeats, so the onsets have no tempo to offer
        return None
    # The octave above the range takes part as a starting level (the hats of a 140 BPM loop are at 280).
    family = [b for b in (peak * 2.0**k for k in range(-2, 3)) if ONSET_RANGE[0] <= b <= 2 * ONSET_RANGE[1]]
    return _within_range(
        choose_octave(
            family,
            {b: strength(ac, fps, b) for b in family},
            {b: pulse(ac, fps, b) for b in family},
            high_only=high_only,
        )
    )


def _within_range(bpm: float | None) -> float | None:
    """A level chosen above the onset range is read an octave down."""
    return bpm / 2 if bpm is not None and bpm > ONSET_RANGE[1] else bpm


def _close(a: float, b: float, tolerance: float) -> bool:
    return abs(a - b) <= tolerance * b


def _octaves_apart(heard: float, bpm: float) -> bool:
    """The onset tempo is this tempo, or one or two octaves from it, within ONSET_AGREES."""
    return any(_close(heard, bpm * 2.0**k, ONSET_AGREES) for k in (-2, -1, 0, 1, 2))


def detect_bpm(mono: np.ndarray, sample_rate: int, file_name: str | None) -> Tempo:
    fits = duration_candidates(len(mono), sample_rate)
    # A NaN or inf sample must not reach the scores: it would make every comparison false.
    signal = np.nan_to_num(np.asarray(mono, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    flux, low_share = _flux(signal, sample_rate)
    ac = _autocorrelation(flux - flux.mean())
    fps = sample_rate / ONSET_HOP
    heard = onset_tempo(ac, fps, high_only=low_share < NO_LOW_END) if ac is not None else None
    beat = None
    scores: dict[float, float] = {}
    if ac is not None and heard is not None:
        scores = {bpm: strength(ac, fps, bpm) for bpm, _ in fits}
        # The onsets chose an octave (onset_tempo); a whole-bar tempo at that octave is the beat. Only
        # when none is (the loop is not whole bars, or an octave off) do the candidates' own strengths
        # order them.
        beat = next((bpm for bpm, _ in fits if _close(heard, bpm, ONSET_AGREES)), None)
    if ac is not None and heard is not None:
        ranked = sorted(fits, key=lambda c: (c[0] != beat, -scores[c[0]]))
    else:  # silence: no onsets, so order by distance from a typical tempo
        ranked = sorted(fits, key=lambda c: abs(math.log2(c[0] / PRIOR_BPM)))
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
    if best is not None and heard is not None and any(_octaves_apart(heard, bpm) for bpm, _ in fits):
        # Whole bars, but the onsets hear another octave: keep the best whole-bar tempo, not agreed.
        return Tempo(_tidy(best[0]), "duration", False, candidates, best[1])
    if heard is not None:  # not whole bars: what the onsets say
        return Tempo(float(round(heard)), "onset", False, candidates, None)
    if best is not None:
        return Tempo(_tidy(best[0]), "duration", False, candidates, best[1])
    return Tempo(None, None, False, candidates, None)


def _tidy(bpm: float) -> float:
    """A whole-bar tempo within 0.01 of a whole number is that number (142.0, not 141.9997)."""
    return float(round(bpm)) if abs(bpm - round(bpm)) < 0.01 else bpm
