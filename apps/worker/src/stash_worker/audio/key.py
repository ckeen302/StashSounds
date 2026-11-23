"""Musical key (build spec: Worker jobs, Loop, Key; ticket 113).

A key in the file name wins. Otherwise the loop's averaged chroma is compared against the 24 rotations
of the Krumhansl-Kessler major and minor profiles, and the margin of the best over the runner-up is the
confidence. Keys are `{"root": 0..11, "mode": "major" | "minor"}` as in contracts musicalKeySchema.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np

MusicalKey = dict[str, Any]

# -- parseKey and formatKey, mirrored from packages/contracts/src/common.ts ------------------------------

SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NOTE_INDEX = {
    "c": 0, "c#": 1, "db": 1, "d": 2, "d#": 3, "eb": 3, "e": 4, "fb": 4, "e#": 5, "f": 5, "f#": 6, "gb": 6,
    "g": 7, "g#": 8, "ab": 8, "a": 9, "a#": 10, "bb": 10, "b": 11, "cb": 11, "b#": 0,
}  # fmt: skip
_KEY = re.compile(r"([a-g])([#b]?)(maj(?:or)?|min(?:or)?|m)?")
# JavaScript's String.prototype.trim and \s: Unicode white space and line terminators.
_JS_SPACE = "\t\n\v\f\r                  　﻿"  # noqa: E501
_JS_SPACES = re.compile(f"[{_JS_SPACE}]+")


def parse_key(text: str) -> MusicalKey | None:
    """parseKey: "F#m", "F# minor", "Fsharpmin", "Ebmaj", "a min", "Am". None for anything else.

    Each replace touches only the first occurrence, as String.prototype.replace with a string does."""
    s = _JS_SPACES.sub("", text.strip(_JS_SPACE).lower())
    s = s.replace("sharp", "#", 1).replace("flat", "b", 1).replace("♯", "#", 1).replace("♭", "b", 1)
    m = _KEY.fullmatch(s)
    if not m:
        return None
    root = NOTE_INDEX.get(m.group(1) + m.group(2))
    if root is None:
        return None
    token = m.group(3)
    mode = "minor" if token and token.startswith("m") and not token.startswith("maj") else "major"
    return {"root": root, "mode": mode}


def format_key(key: MusicalKey) -> str:
    """formatKey: "F#m" for F sharp minor, "Eb" is written "D#". Sharps are canonical."""
    return SHARP_NAMES[key["root"]] + ("m" if key["mode"] == "minor" else "")


# -- keys in file names -----------------------------------------------------------------------------------

_SEPARATORS = re.compile(r"[\s_\-.,()\[\]{}+&~]+")
_LEADING_DIGITS = re.compile(r"\d*")


def _tokens(file_name: str) -> list[str]:
    """Words of the name without its extension. A tempo glued in front ("150F#m") is cut off; digits
    after letters stay, so a chord name such as "Cmaj7" or "Am7" never reads as a key."""
    stem = file_name.rsplit(".", 1)[0] if "." in file_name else file_name
    out: list[str] = []
    for part in _SEPARATORS.split(stem):
        token = part[_LEADING_DIGITS.match(part).end() :]
        if token:
            out.append(token)
    return out


def _plausible(token: str) -> bool:
    """Lowercase "a", "am", "em", "bb" are words in names more often than keys; "A", "Am", "dmin" are kept."""
    return token[0].isupper() or len(token) >= 3


def key_from_name(file_name: str | None) -> MusicalKey | None:
    """The last key written in the name. A pair ("F#", "minor") is tried before its first token alone."""
    if not file_name:
        return None
    tokens = _tokens(file_name)
    found: MusicalKey | None = None
    i = 0
    while i < len(tokens):
        if i + 1 < len(tokens) and _plausible(tokens[i]) and (k := parse_key(f"{tokens[i]} {tokens[i + 1]}")):
            found, i = k, i + 2
            continue
        if _plausible(tokens[i]) and (k := parse_key(tokens[i])):
            found = k
        i += 1
    return found


# -- chroma against the 24 key profiles -----------------------------------------------------------------

# Krumhansl and Kessler (1982) probe-tone ratings, tonic first.
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
CHROMA_FMIN = 65.41  # C2: above a kick drum's fundamental, which would otherwise read as a pitch class
CHROMA_FMAX = 2093.0  # C7
CHROMA_WINDOW = 16384  # 2.7 Hz bins at 44.1 kHz, finer than a semitone at C2 (3.9 Hz)
CHROMA_HOP = 4096
SILENT_FRAME = 1e-6


def _frames(x: np.ndarray, size: int, hop: int) -> np.ndarray:
    if len(x) < size:
        x = np.pad(x, (0, size - len(x)))
    return np.lib.stride_tricks.sliding_window_view(x, size)[::hop]


def pitch_chroma(mono: np.ndarray, sample_rate: int) -> np.ndarray:
    """Averaged chroma: per frame, STFT magnitude from C2 to C7 summed into 12 pitch classes (0 = C) and
    scaled to a maximum of 1, then averaged over the frames that are not silent. Zeros for silence."""
    freqs = np.fft.rfftfreq(CHROMA_WINDOW, 1 / sample_rate)
    band = (freqs >= CHROMA_FMIN) & (freqs <= CHROMA_FMAX)
    pitch_class = (np.round(12 * np.log2(freqs[band] / 440.0)).astype(int) + 9) % 12
    fold = np.zeros((band.sum(), 12))
    fold[np.arange(band.sum()), pitch_class] = 1.0
    window = np.hanning(CHROMA_WINDOW).astype(np.float32)
    total = np.zeros(12)
    count = 0
    frames = _frames(np.asarray(mono, dtype=np.float32), CHROMA_WINDOW, CHROMA_HOP)
    for start in range(0, len(frames), 64):  # in blocks, so a 60 s loop stays a few MB
        mag = np.abs(np.fft.rfft(frames[start : start + 64] * window, axis=1))[:, band]
        chroma = mag @ fold
        peak = chroma.max(axis=1)
        keep = peak > SILENT_FRAME * CHROMA_WINDOW
        total += (chroma[keep] / peak[keep, None]).sum(axis=0)
        count += int(keep.sum())
    return total / count if count else total


def key_from_chroma(chroma: np.ndarray) -> tuple[MusicalKey, float] | None:
    """Best of the 24 profiles by correlation, with its margin over the runner-up (0 to 1)."""
    if not np.any(chroma > 0) or np.allclose(chroma, chroma[0]):
        return None
    scores: list[tuple[float, MusicalKey]] = []
    for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
        for root in range(12):
            r = float(np.corrcoef(chroma, np.roll(profile, root))[0, 1])
            scores.append((r, {"root": root, "mode": mode}))
    scores.sort(key=lambda s: s[0], reverse=True)
    (best, key), (second, _) = scores[0], scores[1]
    return key, round(min(1.0, max(0.0, best - second)), 4)


def detect_key(
    mono: np.ndarray, sample_rate: int, file_name: str | None
) -> tuple[MusicalKey | None, str | None, float | None]:
    """(key, keySource, keyConfidence). A key from the name has no measured confidence."""
    named = key_from_name(file_name)
    if named is not None:
        return named, "filename", None
    found = key_from_chroma(pitch_chroma(mono, sample_rate))
    if found is None:
        return None, None, None
    return found[0], "chroma", found[1]
