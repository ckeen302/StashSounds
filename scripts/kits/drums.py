"""Drum voices for the demo's "inspired by" kits (scripts/build-demo-kits.py).

Every hit is synthesized from oscillators and noise here. Nothing reads, samples or resynthesizes
anyone else's audio: the kits are originals made in the style of a producer's records.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sfx"))
import dsp  # noqa: E402
from dsp import SR, bp, drive, env_perc, hp, lp, n_of, noise, reverb, sine  # noqa: E402

NOTES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(note: str, octave: int = 1) -> float:
    """'F', 1 -> F1 in Hz (A4 = 440)."""
    midi = 12 * (octave + 1) + NOTES[note]
    return 440.0 * 2 ** ((midi - 69) / 12)


def _exp_env(n: int, decay: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.exp(-t / max(decay, 1e-4))


def _sweep(n: int, start: float, end: float, time: float) -> np.ndarray:
    t = np.arange(n) / SR
    return end + (start - end) * np.exp(-t / max(time, 1e-4))


def _click(n: int, rng, f: float = 3500, decay: float = 0.004, gain: float = 0.5) -> np.ndarray:
    return bp(noise(n, rng), f, 0.8) * _exp_env(n, decay) * gain


# ---------------------------------------------------------------------------------------------
# Low end


def sub808(rng, f: float, length: float = 1.8, punch: float = 2.5, amount: float = 1.6, slide_from: float | None = None,
           slide_time: float = 0.12, tail: float = 0.55, crush: int = 0, click: float = 0.35) -> np.ndarray:
    n = n_of(length)
    t = np.arange(n) / SR
    freq = _sweep(n, f * punch, f, 0.018)
    if slide_from:
        glide = f + (slide_from - f) * np.exp(-np.maximum(t - 0.02, 0) / slide_time)
        freq = np.maximum(freq, glide) if slide_from > f else freq + (glide - f)
    body = sine(freq) + 0.12 * sine(freq * 2)
    # The 808 holds, then lets go: a long body that falls off over `tail` of the length.
    hold = np.clip(1 - np.maximum(t - length * (1 - tail), 0) / (length * tail), 0, 1) ** 1.6
    env = (0.55 + 0.45 * np.exp(-t / 0.25)) * hold
    x = body * env
    x = drive(x, amount)
    if crush:
        x = 0.5 * x + 0.5 * dsp.bitcrush(x, crush, 2)
        x = lp(x, 7000)
    x = x + _click(n, rng, 2800, 0.003, click)
    return x


def kick(rng, start: float = 160, end: float = 48, sweep: float = 0.035, decay: float = 0.28, amount: float = 1.8,
         click: float = 0.6, length: float = 0.6, crush: int = 0) -> np.ndarray:
    n = n_of(length)
    freq = _sweep(n, start, end, sweep)
    x = sine(freq) * _exp_env(n, decay)
    x = drive(x, amount)
    x = x + _click(n, rng, 4200, 0.005, click)
    if crush:
        x = dsp.bitcrush(x, crush, 3) * 0.6 + x * 0.4
    return x


# ---------------------------------------------------------------------------------------------
# Snares and claps


def snare(rng, tone: float = 190, body: float = 0.6, decay: float = 0.16, bright: float = 1800, length: float = 0.5,
          amount: float = 1.4, room: float = 0.0, crush: int = 0) -> np.ndarray:
    n = n_of(length)
    tone_part = (sine(_sweep(n, tone * 1.6, tone, 0.01)) + 0.5 * sine(_sweep(n, tone * 2.8, tone * 1.75, 0.01))) * _exp_env(n, 0.05) * body
    wires = hp(noise(n, rng), bright) * _exp_env(n, decay)
    wires = peak_band(wires, 5200, 2.0, 4)
    x = drive(tone_part + wires * 0.9, amount) + _click(n, rng, 6000, 0.002, 0.3)
    if crush:
        x = 0.4 * x + 0.6 * dsp.bitcrush(x, crush, 4)
    if room:
        x = reverb(x, rng, 0.9, room, 6000)
    return x


def peak_band(x, f, q, gain_db):
    return dsp.peak(x, f, q, gain_db)


def clap(rng, bursts: int = 4, spread: float = 0.011, f: float = 1300, q: float = 1.1, tail: float = 0.18,
         length: float = 0.7, room: float = 0.18, amount: float = 1.2, crush: int = 0) -> np.ndarray:
    n = n_of(length)
    src = noise(n, rng)
    env = np.zeros(n)
    t = np.arange(n) / SR
    for i in range(bursts):
        t0 = i * spread * (0.85 + 0.3 * rng.random())
        e = np.where(t >= t0, np.exp(-(t - t0) / (0.006 if i < bursts - 1 else tail)), 0)
        env = np.maximum(env, e)
    x = bp(src, f, q) * env * 1.6 + hp(src, 4000) * env * 0.25
    x = drive(x, amount)
    if crush:
        x = 0.4 * x + 0.6 * dsp.bitcrush(x, crush, 3)
    if room:
        x = reverb(x, rng, 1.1, room, 7000)
    return x


def snap(rng, f: float = 2400, length: float = 0.25) -> np.ndarray:
    n = n_of(length)
    return bp(noise(n, rng), f, 2.2) * _exp_env(n, 0.035) * 1.8 + _click(n, rng, 5000, 0.002, 0.5)


def rim(rng, f: float = 1750, length: float = 0.15) -> np.ndarray:
    n = n_of(length)
    x = sine(f, n) * _exp_env(n, 0.018) + 0.6 * sine(f * 0.48, n) * _exp_env(n, 0.012)
    return bp(x + noise(n, rng) * _exp_env(n, 0.004) * 0.4, f, 0.9) * 2


# ---------------------------------------------------------------------------------------------
# Hats and cymbals: six square partials, the classic metallic recipe, filtered high.

METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]


def _metal(n: int, rng, scale: float = 1.0, noise_mix: float = 0.25) -> np.ndarray:
    x = sum(np.sign(sine(f * scale, n) + 1e-9) for f in METAL) / len(METAL)
    return x + noise(n, rng) * noise_mix


def hat(rng, decay: float = 0.035, scale: float = 1.0, tone: float = 9000, length: float = 0.25, crush: int = 0, noise_mix: float = 0.25) -> np.ndarray:
    n = n_of(length)
    x = hp(bp(_metal(n, rng, scale, noise_mix), tone, 0.7), 6500) * _exp_env(n, decay)
    if crush:
        x = dsp.bitcrush(x, crush, 2) * 0.6 + x * 0.4
    return x


def open_hat(rng, decay: float = 0.28, scale: float = 1.0, tone: float = 9000, length: float = 0.9) -> np.ndarray:
    n = n_of(length)
    t = np.arange(n) / SR
    env = np.exp(-t / decay) * (1 - np.exp(-t / 0.002))
    return hp(bp(_metal(n, rng, scale, 0.35), tone, 0.6), 6000) * env


def shaker(rng, length: float = 0.18) -> np.ndarray:
    n = n_of(length)
    t = np.arange(n) / SR
    env = (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.04)
    return hp(noise(n, rng), 5500) * env * 1.4


def crash(rng, decay: float = 1.3, scale: float = 1.0, length: float = 2.6, dark: float = 0.0) -> np.ndarray:
    n = n_of(length)
    x = _metal(n, rng, scale * 1.6, 0.9) * _exp_env(n, decay)
    x = hp(x, 3500)
    if dark:
        x = lp(x, 9000 - 5000 * dark)
    return reverb(x, rng, 1.6, 0.25, 8000)


# ---------------------------------------------------------------------------------------------
# Percussion


def bell(rng, f: float = 1046.5, decay: float = 0.5, ratio: float = 2.76, index: float = 1.6, length: float = 1.4, room: float = 0.2) -> np.ndarray:
    n = n_of(length)
    env = _exp_env(n, decay)
    mod = sine(f * ratio, n) * index * _exp_env(n, decay * 0.4)
    ph = dsp.phase_of(f, n) + mod
    x = np.sin(ph) * env
    return reverb(x, rng, 1.2, room, 9000) if room else x


def cowbell(rng, f: float = 540, length: float = 0.6, decay: float = 0.12) -> np.ndarray:
    n = n_of(length)
    x = np.sign(sine(f, n)) + np.sign(sine(f * 1.48, n))
    return bp(x, f * 1.6, 1.5) * (0.6 * _exp_env(n, 0.02) + 0.4 * _exp_env(n, decay)) * 1.4


def tom(rng, f: float = 120, decay: float = 0.22, length: float = 0.7) -> np.ndarray:
    n = n_of(length)
    return drive(sine(_sweep(n, f * 1.7, f, 0.03), n) * _exp_env(n, decay), 1.3) + _click(n, rng, 2500, 0.003, 0.3)


def zap(rng, start: float = 3000, end: float = 200, time: float = 0.06, length: float = 0.35) -> np.ndarray:
    n = n_of(length)
    return sine(_sweep(n, start, end, time), n) * _exp_env(n, 0.09)


def wood(rng, f: float = 900, length: float = 0.15) -> np.ndarray:
    n = n_of(length)
    return bp(sine(f, n) * _exp_env(n, 0.025) + noise(n, rng) * _exp_env(n, 0.003) * 0.5, f, 2.5) * 2.2


def glitch(rng, length: float = 0.5, rate: float = 0.03) -> np.ndarray:
    """Stuttered, crushed noise and tone: an original glitch hit."""
    n = n_of(length)
    t = np.arange(n) / SR
    gate = (np.floor(t / rate) % 2 == 0).astype(float)
    tone = np.sign(sine(_sweep(n, 1600, 400, 0.15), n))
    x = (tone * 0.6 + noise(n, rng) * 0.5) * gate * _exp_env(n, 0.2)
    return dsp.bitcrush(lp(x, 6000), 5, 6)


# ---------------------------------------------------------------------------------------------
# FX


def riser(rng, length: float = 2.0) -> np.ndarray:
    n = n_of(length)
    t = np.arange(n) / SR
    cutoff = 300 + 9000 * (t / length) ** 2
    x = dsp.blockfilter(noise(n, rng), cutoff, "bp", 1.2) * (t / length) ** 1.5
    return reverb(x, rng, 1.0, 0.3, 9000)


def reverse(x: np.ndarray) -> np.ndarray:
    return dsp.to_stereo(x)[::-1].copy()


def impact(rng, length: float = 2.2) -> np.ndarray:
    n = n_of(length)
    sub = sine(_sweep(n, 120, 32, 0.25), n) * _exp_env(n, 0.7)
    hit = lp(noise(n, rng), 2500) * _exp_env(n, 0.12)
    return reverb(drive(sub * 1.2 + hit * 0.8, 1.6), rng, 2.4, 0.35, 4000)


def stab(rng, root: float = 130.8, minor: bool = True, length: float = 1.8) -> np.ndarray:
    """An orchestral-style minor stab built from detuned saws and a low octave, with a hall."""
    n = n_of(length)
    third = 2 ** ((3 if minor else 4) / 12)
    fifth = 2 ** (7 / 12)
    x = np.zeros(n)
    for r in (1, third, fifth, 2, 0.5):
        for d in (0.996, 1.0, 1.004):
            x += dsp.saw(root * r * d, n, 24)
    env = (1 - np.exp(-np.arange(n) / SR / 0.004)) * _exp_env(n, 0.35)
    x = lp(x * env, 3200) / 10
    return reverb(x, rng, 2.6, 0.45, 5000)


def brass(rng, root: float = 98.0, length: float = 1.6) -> np.ndarray:
    n = n_of(length)
    t = np.arange(n) / SR
    cutoff = 400 + 2600 * np.exp(-t / 0.25)
    x = sum(dsp.saw(root * r, n, 30) for r in (1, 1.5, 2))
    x = dsp.blockfilter(x, cutoff, "lp", 0.9) * (1 - np.exp(-t / 0.02)) * _exp_env(n, 0.6)
    return reverb(drive(x / 3, 1.5), rng, 2.0, 0.35, 5000)
