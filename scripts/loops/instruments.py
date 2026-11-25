"""Instruments for the loop library: multisampled CC0 instruments (VCSL and VSCO 2 CE), synth voices
and the drum machine. Every voice returns a stereo (n, 2) array that starts at the note's onset.
"""
import math
import os
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

from dsp import SR, adsr, chorus, fade, hp, hz, lp, bp, noise, resample, rng, saturate, saw, sine, square, stereo, sweep_lp, tri, eq

LIB = Path(os.environ.get("STASH_INSTRUMENTS", Path(__file__).resolve().parents[2] / ".local/instruments"))

PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
NOTE_RE = re.compile(r"^([A-G](?:#|b)?)(-?\d)$")
VEL_WORDS = {"pp": 1, "ppp": 0, "p": 2, "soft": 2, "quiet": 2, "mp": 3, "med": 4, "medium": 4, "mf": 4, "f": 6, "f1": 6, "loud": 6, "hard": 6, "ff": 7, "fff": 8}

# name: (folder under LIB, filename filter regex, release seconds, gain, semitones the sounding pitch
# sits above the file name's note: measured with scripts/loops/check-tuning.py)
SAMPLED = {
    "grand": ("vcsl/Chordophones/Zithers/Grand Piano, Steinway B/NoSus", r"", 0.35, 1.0, 0),
    "fmpiano": ("vcsl/Electrophones/TX81Z/FM Piano", r"", 0.4, 0.9, 0),
    "clavi": ("vcsl/Electrophones/TX81Z/Clavisynth", r"", 0.2, 0.8, 24),
    "vibes": ("vcsl/Idiophones/Struck Idiophones/Vibraphone", r"Vibes_(soft|hard)", 0.6, 0.9, 12),
    "glock": ("vcsl/Idiophones/Struck Idiophones/Glockenspiel", r"", 0.5, 0.7, 12),
    "marimba": ("vcsl/Idiophones/Struck Idiophones/Marimba", r"", 0.3, 1.0, 12),
    "kalimba": ("vcsl/Idiophones/Plucked Idiophones/Kalimba, Kenya", r"", 0.4, 1.0, 12),
    "tubular": ("vcsl/Idiophones/Struck Idiophones/Tubular Bells 2", r"", 1.0, 0.7, 12),
    "chimes": ("vcsl/Idiophones/Struck Idiophones/Hand Chimes", r"", 1.0, 0.8, 12),
    "organ": ("vcsl/Aerophones/Edge-blown Aerophones/Pipe Organ", r"", 0.25, 0.6, 12),
    "harp": ("vcsl/Chordophones/Composite Chordophones/Concert Harp", r"", 0.8, 1.0, 0),
    "sax": ("vcsl/Aerophones/Reed Aerophones/Tenor Saxophone", r"(?i)sus|vib|norm", 0.15, 0.8, 12),
    "strings": ("vsco/Strings/Violin Section", r"susVib", 0.35, 0.9, 12),
    "violas": ("vsco/Strings/Viola Section", r"susvib", 0.35, 0.9, 12),
    "celli": ("vsco/Strings/Cello Section", r"susvib", 0.35, 1.0, 12),
    "spic": ("vsco/Strings/Violin Section", r"Spic", 0.12, 0.9, 12),
    "cellospic": ("vsco/Strings/Cello Section", r"spic", 0.12, 1.0, 12),
    "pizz": ("vsco/Strings/Violin Section", r"Pizz", 0.2, 1.0, 12),
    "flute": ("vsco/Woodwinds/Flute", r"susvib", 0.2, 0.9, 12),
    "flutestac": ("vsco/Woodwinds/Flute", r"stac", 0.1, 0.9, 12),
    "horn": ("vsco/Brass/F Horn/sus", r"", 0.3, 0.9, 12),
    "trombone": ("vsco/Brass/Tenor Trombone/sus", r"", 0.3, 0.9, 12),
    "bass": ("vsco/Strings/Solo Contrabass", r"Pizz", 0.2, 1.0, 12),
}


def _parse(name):
    toks = re.split(r"[_ \-.]", name)
    note = None
    vel = 4
    rr = 1
    for t in toks:
        m = NOTE_RE.match(t)
        if m and note is None and m.group(1) in PC:
            note = (int(m.group(2)) + 1) * 12 + PC[m.group(1)]
            continue
        tl = t.lower()
        if re.fullmatch(r"v[l]?\d", tl):
            vel = int(tl[-1]) * 2
        elif tl in VEL_WORDS:
            vel = VEL_WORDS[tl]
        elif re.fullmatch(r"rr\d", tl):
            rr = int(tl[2:])
    return note, vel, rr


def _load(path):
    x, sr = sf.read(path, dtype="float64", always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    x = x[:, :2]
    if sr != SR:
        g = math.gcd(sr, SR)
        x = signal.resample_poly(x, SR // g, sr // g, axis=0)
    # Trim the silence before the onset so notes land on the grid.
    env = np.max(np.abs(x), axis=1)
    peak = env.max() + 1e-9
    thr = np.nonzero(env > peak * 0.03)[0]
    start = max(0, (thr[0] if len(thr) else 0) - int(0.0015 * SR))
    x = x[start:]
    # Drop trailing near-silence.
    tail = np.nonzero(env[start:] > peak * 0.0008)[0]
    if len(tail):
        x = x[: tail[-1] + 1]
    x = fade(x, 0.0008, 0.05)
    return x


def detect_f0(x, lo=40, hi=2500):
    """Fundamental of a sample's body (after the attack), by autocorrelation."""
    m = x.mean(axis=1) if x.ndim == 2 else x
    seg = m[int(0.08 * SR) : int(0.08 * SR) + 8192]
    if len(seg) < 4096:
        seg = m[: 8192]
    seg = seg - seg.mean()
    seg = seg * np.hanning(len(seg))
    f = np.fft.rfft(seg, 4 * len(seg))
    ac = np.fft.irfft(np.abs(f) ** 2)[: len(seg)]
    a, b = int(SR / hi), int(SR / lo)
    if b >= len(ac):
        b = len(ac) - 1
    k = a + int(np.argmax(ac[a:b]))
    # Prefer the shortest lag that is nearly as strong (avoid octave-down errors).
    best = ac[k]
    for div in (4, 3, 2):
        kk = k / div
        i = int(round(kk))
        if a <= i and ac[i] > 0.85 * best:
            k = i
            break
    return SR / k


class Sampler:
    def __init__(self, name):
        folder, pat, self.release, self.gain, self.shift = SAMPLED[name]
        self.name = name
        root = LIB / folder
        files = sorted(p for p in root.rglob("*.wav") if re.search(pat, p.name)) if pat else sorted(root.rglob("*.wav"))
        zones = {}
        for p in files:
            note, vel, rr = _parse(p.stem)
            if note is None:
                continue
            zones.setdefault(note, []).append((vel, rr, p))
        if not zones:
            raise RuntimeError(f"{name}: no samples in {root}")
        self.zones = zones
        self.notes = np.array(sorted(zones))
        self._cache = {}

    def _sample(self, note, vel, rr):
        choices = self.zones[note]
        vels = sorted({v for v, _, _ in choices})
        v = min(vels, key=lambda q: abs(q - vel))
        cand = [c for c in choices if c[0] == v]
        c = cand[(rr - 1) % len(cand)]
        key = c[2]
        if key not in self._cache:
            self._cache[key] = _load(c[2])
        return self._cache[key]

    def note(self, p, dur, vel=100, rr=1, release=None):
        """p: MIDI note, dur: seconds held, vel: 1-127."""
        target = p - self.shift
        i = int(np.argmin(np.abs(self.notes - target)))
        root = int(self.notes[i])
        vel_layer = 1 + (vel / 127) * 7
        x = self._sample(root, vel_layer, rr)
        ratio = 2 ** ((target - root) / 12)
        rel = self.release if release is None else release
        need = int((dur + rel * 3) * SR * ratio) + 16
        x = resample(x[:need], ratio) if ratio != 1 else x[:need]
        n = len(x)
        t = np.arange(n) / SR
        e = np.ones(n)
        rs = int(dur * SR)
        if rs < n:
            e[rs:] = np.exp(-(t[rs:] - dur) / max(rel, 1e-3))
        e = e * min(1.0, 0.25 + 0.75 * (vel / 127) ** 1.2)
        y = x * e[:, None] * self.gain
        y = fade(y, 0.0005, 0.01)
        return y


@lru_cache(maxsize=None)
def sampler(name):
    return Sampler(name)


# ---------- synth voices ----------


def _vib(n, depth_semi=0.15, rate=5.5, delay=0.25):
    t = np.arange(n) / SR
    amt = np.clip((t - delay) / 0.3, 0, 1) * depth_semi
    return 2 ** (amt * np.sin(2 * np.pi * rate * t) / 12)


def synth(kind, p, dur, vel=100, seed=0, glide_from=None):
    f = hz(p)
    v = (vel / 127) ** 1.1
    g = rng(seed + p * 31)
    if kind == "pluggbell":
        n = int((dur + 1.2) * SR)
        t = np.arange(n) / SR
        mod = np.sin(2 * np.pi * f * 2 * t) * 1.3 * np.exp(-t * 7)
        x = np.sin(2 * np.pi * f * t + mod) + 0.25 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 12)
        e = adsr(n, 0.002, 0.45, 0.2, dur, 0.35)
        return stereo(x * e * v * 0.4)
    if kind == "softbell":
        n = int((dur + 1.6) * SR)
        t = np.arange(n) / SR
        x = np.sin(2 * np.pi * f * t + 0.8 * np.exp(-t * 4) * np.sin(2 * np.pi * f * 3.01 * t)) + 0.15 * np.sin(2 * np.pi * f * 2 * t)
        e = np.exp(-t * 1.6) * np.clip(t / 0.003, 0, 1)
        return stereo(x * e * v * 0.4)
    if kind == "musicbox":
        n = int((dur + 1.5) * SR)
        t = np.arange(n) / SR
        x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 5.95 * t) * np.exp(-t * 6) + 0.2 * np.sin(2 * np.pi * f * 3 * t) * np.exp(-t * 3)
        e = np.exp(-t * 2.4) * np.clip(t / 0.001, 0, 1)
        return stereo(x * e * v * 0.35)
    if kind in ("lead", "pluggLead"):
        n = int((dur + 0.25) * SR)
        fr = f * _vib(n, 0.18, 5.2, 0.2)
        if glide_from is not None:
            t = np.arange(n) / SR
            fr = fr * 2 ** ((glide_from - p) / 12 * np.exp(-t / 0.04))
        x = 0.6 * square(fr, n, width=0.42) + 0.5 * tri(fr * 2, n) * 0.3
        x = lp(x, 3200 if kind == "lead" else 2200)
        e = adsr(n, 0.008, 0.3, 0.75, dur, 0.09)
        return stereo(x * e * v * 0.32)
    if kind in ("supersaw", "ragelead", "ragebrass"):
        n = int((dur + 0.35) * SR)
        voices = 7
        spread = 0.22 if kind != "ragebrass" else 0.12
        out = np.zeros((n, 2))
        for k in range(voices):
            det = (k - (voices - 1) / 2) / ((voices - 1) / 2) * spread
            x = saw(f * 2 ** (det / 12), n, phase0=g.random())
            pan = (k - (voices - 1) / 2) / ((voices - 1) / 2) * 0.9
            out += stereo(x, pan) * (1.0 if k == voices // 2 else 0.7)
        out /= voices * 0.75
        if kind == "ragelead":
            out += stereo(square(f / 2, n) * 0.35)
            out = saturate(out, 2.5)
        cut = {"supersaw": 7000, "ragelead": 9000, "ragebrass": 2600}[kind]
        if kind == "ragebrass":
            out = sweep_lp(out, 5500, cut, 0.12, q=1.2)
        else:
            out = lp(out, cut)
        e = adsr(n, 0.004, 0.6, 0.8, dur, 0.12)
        return out * e[:, None] * v * 0.3
    if kind == "pluck":
        n = int((dur + 0.6) * SR)
        x = sum(saw(f * 2 ** (d / 1200), n, g.random()) for d in (-8, 0, 8)) / 3
        x = sweep_lp(x, 7000, 600, 0.09, q=1.1)
        e = adsr(n, 0.001, 0.25, 0.0, dur, 0.15)
        return chorus(stereo(x * e * v * 0.55), mix=0.3)
    if kind in ("pad", "darkpad", "warmpad"):
        n = int((dur + 1.2) * SR)
        out = np.zeros((n, 2))
        for k, d in enumerate((-11, -4, 4, 11)):
            out += stereo(saw(f * 2 ** (d / 1200), n, g.random()), -0.7 + k * 0.47)
        out /= 3
        cut = {"pad": 2600, "darkpad": 1100, "warmpad": 1700}[kind]
        out = lp(out, cut, order=2)
        out = out + stereo(sine(f / 2, n) * (0.25 if kind != "pad" else 0.1))
        e = adsr(n, 0.35, 1.0, 0.85, dur, 0.9)
        return out * e[:, None] * v * 0.16
    if kind == "choir":
        n = int((dur + 1.2) * SR)
        fr = f * _vib(n, 0.08, 4.8, 0.1)
        src = sum(saw(fr * 2 ** (d / 1200), n, g.random()) for d in (-9, 0, 9)) / 3
        x = np.zeros(n)
        for fm, bw, gain in ((700, 140, 1.0), (1150, 180, 0.6), (2600, 260, 0.25), (3300, 300, 0.12)):
            x += bp(src, fm - bw / 2, fm + bw / 2) * gain
        x = x * 3.2 + lp(src, 600) * 0.2
        e = adsr(n, 0.25, 1.0, 0.9, dur, 0.8)
        return chorus(stereo(x * e * v * 0.32), mix=0.5)
    if kind == "cowbell":
        # The drum machine's cowbell, played as a melody.
        n = int((dur + 0.35) * SR)
        t = np.arange(n) / SR
        r = f / 540
        x = square(540 * r, n) * 0.6 + square(800 * r, n) * 0.6
        x = bp(x, 450 * r, 2800 * r)
        e = np.exp(-t / 0.045) * 0.6 + np.exp(-t / 0.22) * 0.4
        e *= np.clip((dur + 0.08 - t) / 0.04, 0, 1)
        return stereo(saturate(x * e, 1.5) * v * 0.45)
    if kind == "epiano":
        n = int((dur + 0.8) * SR)
        t = np.arange(n) / SR
        x = np.sin(2 * np.pi * f * t + 1.1 * np.exp(-t * 6) * np.sin(2 * np.pi * f * t)) + 0.2 * np.sin(2 * np.pi * f * 14 * t) * np.exp(-t * 25)
        e = adsr(n, 0.002, 1.2, 0.35, dur, 0.3)
        return chorus(stereo(x * e * v * 0.4), depth_ms=2, rate=4.5, mix=0.35)
    if kind == "guitar":
        return _ks(f, dur, v, seed + p, bright=0.55, body=True) * 1.0
    if kind == "eguitar":
        x = _ks(f, dur, v, seed + p, bright=0.75, body=False)
        return chorus(x, mix=0.4)
    if kind == "sub":
        n = int((dur + 0.1) * SR)
        x = sine(f, n)
        return stereo(x * adsr(n, 0.005, 1, 1, dur, 0.04) * v * 0.6)
    if kind == "sawbass":
        n = int((dur + 0.1) * SR)
        x = saw(f, n) * 0.6 + sine(f, n) * 0.6
        x = sweep_lp(x, 2600, 380, 0.12, q=1.0)
        return stereo(saturate(x, 2) * adsr(n, 0.003, 0.3, 0.7, dur, 0.04) * v * 0.45)
    raise ValueError(kind)


def _ks(f, dur, v, seed, bright=0.6, body=True):
    """Karplus-Strong plucked string, computed one period at a time."""
    g = rng(seed)
    total = int((dur + 1.0) * SR)
    N = max(2, int(SR / f))
    exc = g.uniform(-1, 1, N)
    exc = lp(exc, 1500 + 6500 * bright)
    out = np.zeros(total + N)
    out[:N] = exc
    damp = 0.5 * (0.996 if dur > 0.6 else 0.993)
    i = N
    while i < total:
        prev = out[i - N : i]
        nxt = np.empty(N)
        nxt[1:] = prev[1:] + prev[:-1]
        nxt[0] = prev[0] + out[i - N - 1] if i - N - 1 >= 0 else prev[0] * 2
        out[i : i + N] = nxt * damp
        i += N
    y = out[:total]
    # Tune: the integer delay gives SR/N; resample to the exact pitch.
    y = resample(y, f * N / SR)
    t = np.arange(len(y)) / SR
    e = np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.08))
    y = y * e
    if body:
        y = eq(y, "peak", 110, 5, 1.2)
        y = eq(y, "peak", 220, 3, 1.5)
        y = eq(y, "highshelf", 4000, -6)
    y = hp(y, 70)
    return stereo(fade(y, 0.0005, 0.02) * v * 0.6)


# ---------- drums ----------


def kick(kind="trap", vel=110, seed=0):
    v = (vel / 127)
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    start, end, tau = {"trap": (190, 48, 0.035), "punch": (230, 55, 0.025), "boom": (160, 50, 0.05), "rage": (260, 52, 0.02)}[kind]
    fr = end + (start - end) * np.exp(-t / tau)
    body = np.sin(2 * np.pi * np.cumsum(fr) / SR)
    e = np.exp(-t / (0.16 if kind != "boom" else 0.22))
    click = hp(noise(n, seed + 1), 2500) * np.exp(-t / 0.004) * 0.5
    x = saturate(body * e * 1.2, 2.2 if kind == "rage" else 1.6) + click
    return stereo(fade(x * v * 0.9, 0, 0.02))


def eight08(notes, total, glide_time=0.07, drive=1.8, decay=None, sub_only=False):
    """A monophonic 808: notes are (start_s, dur_s, pitch, vel, glide). Glide notes slide in from the previous pitch."""
    out = np.zeros(total)
    freq = np.zeros(total)
    amp = np.zeros(total)
    for k, (s, d, p, vel, glide) in enumerate(notes):
        a = int(s * SR)
        b = min(total, int((s + d) * SR))
        if a >= total:
            continue
        seg_t = np.arange(b - a) / SR
        f = hz(p)
        if glide and k > 0:
            pf = hz(notes[k - 1][2])
            fr = f + (pf - f) * np.exp(-seg_t / glide_time * 3)
        else:
            fr = f * (1 + 0.6 * np.exp(-seg_t / 0.012))
        freq[a:b] = fr
        dec = decay if decay else max(0.35, d * 1.2)
        env = np.exp(-seg_t / dec) * 0.75 + 0.25 * np.exp(-seg_t / (dec * 3))
        if glide and k > 0:
            env = np.maximum(env, 0.6)
        att = np.clip(seg_t / 0.003, 0, 1) if not (glide and k > 0) else 1
        rel = np.clip((d - seg_t) / 0.025, 0, 1)
        amp[a:b] = env * att * rel * (vel / 127)
    ph = np.cumsum(freq) / SR
    x = np.sin(2 * np.pi * ph)
    if not sub_only:
        x = saturate(x * 1.3, drive)
        x = x + 0.12 * np.sin(4 * np.pi * ph)
    out = x * amp
    out = lp(out, 4500)
    # A click at each new note helps the 808 cut through on small speakers.
    return stereo(out * 0.75)


def snare(kind="trap", vel=110, seed=0):
    v = vel / 127
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    tone_f = {"trap": 190, "drill": 210, "boom": 175, "rim": 420}[kind]
    tone = np.sin(2 * np.pi * tone_f * t * (1 + 0.3 * np.exp(-t / 0.01))) * np.exp(-t / 0.05)
    nz = bp(noise(n, seed + 7), 1200, 9500) * np.exp(-t / (0.12 if kind != "boom" else 0.17))
    x = tone * 0.6 + nz * 0.9
    if kind == "rim":
        x = bp(np.sin(2 * np.pi * 1700 * t) + noise(n, seed) * 0.4, 600, 4000) * np.exp(-t / 0.018)
    x = saturate(x, 1.6)
    return stereo(x * v * 0.75)


def clap(vel=110, seed=0, tail=0.18):
    v = vel / 127
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    nz = bp(noise(n, seed + 3), 900, 5500)
    e = np.zeros(n)
    for k, off in enumerate((0, 0.009, 0.018, 0.026)):
        i = int(off * SR)
        e[i:] += np.exp(-(t[i:] - off) / (0.006 if k < 3 else tail)) * (0.8 if k < 3 else 1)
    x = nz * e
    x = eq(x, "peak", 1300, 4, 1.0)
    return stereo(saturate(x, 1.4) * v * 0.6)


HAT_F = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)


@lru_cache(maxsize=64)
def _hat_raw(decay_ms, tone):
    n = int((decay_ms / 1000 * 6 + 0.02) * SR)
    t = np.arange(n) / SR
    x = sum(square(f * tone, n) for f in HAT_F) / 6
    x = x + noise(n, 99) * 0.5
    x = bp(x, 6500, 16000, order=2)
    x = hp(x, 7000)
    e = np.exp(-t / (decay_ms / 1000)) * np.clip(t / 0.0006, 0, 1)
    return x * e


def hat(vel=90, decay_ms=28, tone=1.0, pan=0.0):
    x = _hat_raw(decay_ms, round(tone, 3)) * (vel / 127) * 0.55
    return stereo(x, pan)


def openhat(vel=90, decay_ms=230, tone=1.0):
    return hat(vel, decay_ms, tone) * 0.8


def shaker(vel=80, seed=0):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    x = bp(noise(n, seed + 21), 4500, 14000) * (np.clip(t / 0.012, 0, 1) * np.exp(-t / 0.03))
    return stereo(x * vel / 127 * 0.35)


def perc(kind, vel=100, p=None):
    """Sampled percussion from the CC0 libraries."""
    folder = {
        "tamb": "vcsl/Idiophones/Struck Idiophones/Tambourine 1",
        "shake": "vcsl/Idiophones/Struck Idiophones/Shaker, Small",
        "clapreal": "vcsl/Idiophones/Struck Idiophones/Claps",
        "cowbellreal": "vcsl/Idiophones/Struck Idiophones/Cowbells",
    }[kind]
    files = sorted((LIB / folder).rglob("*.wav"))
    if not files:
        return np.zeros((1, 2))
    x = _cached_load(str(files[(p or 0) % len(files)]))
    return x * vel / 127


@lru_cache(maxsize=None)
def _cached_load(path):
    return _load(path)
