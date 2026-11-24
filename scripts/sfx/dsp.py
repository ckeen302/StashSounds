"""Small DSP kit for the demo's synthesized sound effects (scripts/build-demo-sfx.py).

Everything is float64 numpy at 44.1 kHz. Mono signals are 1-D arrays; stereo is (n, 2).
Nothing here reads or copies outside audio: every synthesized sound is an original.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

SR = 44100


def t_axis(sec: float) -> np.ndarray:
    return np.arange(int(sec * SR)) / SR


def n_of(sec: float) -> int:
    return int(sec * SR)


def curve(points: list[tuple[float, float]], sec: float, kind: str = "lin") -> np.ndarray:
    """A breakpoint curve sampled at SR: points are (time_s, value)."""
    t = t_axis(sec)
    xs = np.array([p[0] for p in points])
    ys = np.array([p[1] for p in points], dtype=float)
    if kind == "exp":
        return np.exp(np.interp(t, xs, np.log(np.maximum(ys, 1e-9))))
    return np.interp(t, xs, ys)


def phase_of(freq: np.ndarray | float, n: int | None = None) -> np.ndarray:
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=float)
    return 2 * np.pi * np.cumsum(f) / SR


def sine(freq, n=None):
    return np.sin(phase_of(freq, n))


def saw(freq, n=None, harmonics: int = 40):
    """Band-limited-ish saw by additive partials, cut above Nyquist per sample."""
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=float)
    ph = phase_of(f)
    out = np.zeros_like(ph)
    for k in range(1, harmonics + 1):
        mask = (k * f) < SR * 0.45
        if not mask.any():
            break
        out += mask * np.sin(k * ph) / k
    return out * (2 / np.pi)


def square(freq, n=None, harmonics: int = 30, duty_soft: float = 1.0):
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=float)
    ph = phase_of(f)
    out = np.zeros_like(ph)
    for k in range(1, harmonics * 2, 2):
        mask = (k * f) < SR * 0.45
        if not mask.any():
            break
        out += mask * np.sin(k * ph) / (k**duty_soft)
    return out * (4 / np.pi)


def tri(freq, n=None):
    f = np.full(n, float(freq)) if np.isscalar(freq) else np.asarray(freq, dtype=float)
    ph = phase_of(f)
    out = np.zeros_like(ph)
    for i, k in enumerate(range(1, 30, 2)):
        mask = (k * f) < SR * 0.45
        out += mask * ((-1) ** i) * np.sin(k * ph) / (k * k)
    return out * (8 / np.pi**2)


def noise(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.uniform(-1, 1, n)


def pink(n: int, rng: np.random.Generator) -> np.ndarray:
    w = rng.standard_normal(n)
    spec = np.fft.rfft(w)
    f = np.arange(len(spec))
    f[0] = 1
    spec /= np.sqrt(f)
    out = np.fft.irfft(spec, n)
    return out / (np.max(np.abs(out)) + 1e-9)


def brown(n: int, rng: np.random.Generator) -> np.ndarray:
    out = np.cumsum(rng.standard_normal(n))
    out = signal.lfilter([1, -1], [1, -0.999], out)
    return out / (np.max(np.abs(out)) + 1e-9)


# ---------------------------------------------------------------------------------------------
# Filters


def _sos(kind: str, f, q: float = 0.707, order: int = 2):
    if kind == "bp":
        bw = f / q
        lo, hi = max(10.0, f - bw / 2), min(SR / 2 - 100, f + bw / 2)
        return signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.butter(order, min(f, SR / 2 - 100), btype="low" if kind == "lp" else "high", fs=SR, output="sos")


def lp(x, f, order=2):
    return signal.sosfilt(_sos("lp", f, order=order), x, axis=0)


def hp(x, f, order=2):
    return signal.sosfilt(_sos("hp", f, order=order), x, axis=0)


def bp(x, f, q=2.0, order=2):
    return signal.sosfilt(_sos("bp", f, q, order), x, axis=0)


def peak(x, f, q, gain_db):
    """RBJ peaking EQ."""
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f / SR
    alpha = np.sin(w0) / (2 * q)
    b = [1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a]
    aa = [1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a]
    return signal.lfilter(b, aa, x, axis=0)


def svf(x: np.ndarray, cutoff: np.ndarray | float, res: float = 0.5, mode: str = "lp") -> np.ndarray:
    """Time-varying state-variable filter (Chamberlin, oversampled 2x), cutoff per sample."""
    n = len(x)
    fc = np.full(n, float(cutoff)) if np.isscalar(cutoff) else np.asarray(cutoff, dtype=float)
    fc = np.clip(fc, 20, SR * 0.2)
    f = 2 * np.sin(np.pi * fc / (2 * SR))
    q = 1.0 - np.clip(res, 0, 0.97)
    q2 = q * 2
    lo = bd = 0.0
    out = np.empty(n)
    # Pure-python loop kept small: block it through numba-free vector math is not possible for an
    # IIR, so the callers keep time-varying filters to short sounds.
    xl = x.tolist()
    fl = f.tolist()
    sel = {"lp": 0, "bp": 1, "hp": 2}[mode]
    for i in range(n):
        fi = fl[i]
        xi = xl[i]
        for _ in range(2):
            lo += fi * bd
            hi = xi - lo - q2 * bd
            bd += fi * hi
        out[i] = lo if sel == 0 else (bd if sel == 1 else hi)
    return out


def blockfilter(x: np.ndarray, cutoff: np.ndarray, kind: str = "lp", q: float = 0.707, block: int = 256) -> np.ndarray:
    """Fast time-varying filter: a biquad updated every `block` samples, state carried over."""
    out = np.empty_like(x)
    zi = np.zeros((1, 2))
    for s in range(0, len(x), block):
        e = min(len(x), s + block)
        fc = float(np.clip(cutoff[s], 30, SR / 2 - 500))
        if kind == "bp":
            sos = _sos("bp", fc, q)
            zi = zi if zi.shape[0] == sos.shape[0] else np.zeros((sos.shape[0], 2))
        else:
            sos = _sos(kind, fc)
        if zi.shape[0] != sos.shape[0]:
            zi = np.zeros((sos.shape[0], 2))
        out[s:e], zi = signal.sosfilt(sos, x[s:e], zi=zi)
    return out


# ---------------------------------------------------------------------------------------------
# Envelopes and shaping


def env_adsr(n: int, a: float, d: float, s: float, r: float, hold: float | None = None) -> np.ndarray:
    a_n, d_n, r_n = n_of(a), n_of(d), n_of(r)
    h_n = n - a_n - d_n - r_n if hold is None else n_of(hold)
    h_n = max(0, h_n)
    e = np.concatenate([np.linspace(0, 1, max(1, a_n)), np.linspace(1, s, max(1, d_n)), np.full(h_n, s), np.linspace(s, 0, max(1, r_n))])
    if len(e) < n:
        e = np.concatenate([e, np.zeros(n - len(e))])
    return e[:n]


def env_perc(n: int, attack: float, decay: float, curve_pow: float = 1.0) -> np.ndarray:
    t = np.arange(n) / SR
    att = np.clip(t / max(attack, 1e-5), 0, 1)
    dec = np.exp(-np.maximum(0, t - attack) / max(decay, 1e-5))
    return att * dec**curve_pow


def fade(x: np.ndarray, fin: float = 0.003, fout: float = 0.02) -> np.ndarray:
    x = x.copy()
    a, b = n_of(fin), n_of(fout)
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None] if x.ndim == 2 else np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None] if x.ndim == 2 else np.linspace(1, 0, b)
    return x


def drive(x, amount: float = 2.0):
    return np.tanh(x * amount) / np.tanh(amount)


def bitcrush(x, bits: int = 8, down: int = 4):
    y = np.repeat(x[::down], down)[: len(x)]
    q = 2 ** (bits - 1)
    return np.round(y * q) / q


def pad(x: np.ndarray, sec: float) -> np.ndarray:
    z = np.zeros((n_of(sec),) + x.shape[1:])
    return np.concatenate([x, z])


def at(total: np.ndarray, x: np.ndarray, start_s: float, gain: float = 1.0) -> np.ndarray:
    s = n_of(start_s)
    if s >= len(total):
        return total
    e = min(len(total), s + len(x))
    total[s:e] += x[: e - s] * gain
    return total


def mix(*parts: np.ndarray) -> np.ndarray:
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


# ---------------------------------------------------------------------------------------------
# Space


def reverb_ir(sec: float, rng: np.random.Generator, damp: float = 4000.0, stereo: bool = True, predelay: float = 0.01) -> np.ndarray:
    n = n_of(sec)
    t = np.arange(n) / SR
    env = np.exp(-6.9 * t / sec)
    chans = []
    for _ in range(2 if stereo else 1):
        w = rng.standard_normal(n) * env
        w = lp(w, damp)
        w = np.concatenate([np.zeros(n_of(predelay)), w])
        chans.append(w)
    ir = np.stack(chans, axis=1) if stereo else chans[0]
    return ir / np.sqrt(np.sum(ir**2) / (2 if stereo else 1))


def reverb(x: np.ndarray, rng: np.random.Generator, sec: float = 1.5, wet: float = 0.3, damp: float = 5000.0) -> np.ndarray:
    """Mono or stereo in, stereo out."""
    dry = to_stereo(x)
    ir = reverb_ir(sec, rng, damp)
    out = np.zeros((len(dry) + len(ir) - 1, 2))
    for c in range(2):
        out[:, c] = signal.fftconvolve(dry[:, c], ir[:, c])
    out = out * wet * 0.35
    out[: len(dry)] += dry * (1 - wet * 0.5)
    return out


def to_stereo(x: np.ndarray, width: float = 0.0) -> np.ndarray:
    if x.ndim == 2:
        return x
    return np.stack([x, x], axis=1)


def pan(x: np.ndarray, p: np.ndarray | float) -> np.ndarray:
    """Equal-power pan, -1 left to 1 right."""
    p = np.full(len(x), float(p)) if np.isscalar(p) else p
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def doppler_pass(x: np.ndarray, sec: float, speed: float = 30.0, closest: float = 6.0, rng=None) -> np.ndarray:
    """A source passing a listener: variable delay (pitch shift), distance gain and air absorption, pan sweep.

    x is the source as heard at the source; returns stereo of the same length.
    """
    n = len(x)
    t = np.arange(n) / SR
    tc = sec / 2
    pos = (t - tc) * speed
    dist = np.sqrt(pos**2 + closest**2)
    delay = dist / 343.0
    src_t = t - delay
    src_i = np.clip(src_t * SR, 0, n - 1)
    y = np.interp(src_i, np.arange(n), x)
    gain = closest / dist
    y = y * gain
    # Air: farther is duller, done as a crossfade between the signal and a lowpassed copy.
    dull = lp(y, 900)
    mixk = np.clip((dist - closest) / (speed * sec / 3), 0, 1)
    y = y * (1 - mixk) + dull * mixk
    p = np.clip(pos / (closest * 2), -1, 1)
    return pan(y, p)


# ---------------------------------------------------------------------------------------------
# Output


def finish(x: np.ndarray, peak_db: float = -1.0, fin: float = 0.002, fout: float = 0.03, trim: bool = True) -> np.ndarray:
    x = to_stereo(np.asarray(x, dtype=float))
    x = x - np.mean(x, axis=0)
    x = hp(x, 25)
    if trim:
        level = np.max(np.abs(x), axis=1)
        thresh = np.max(level) * 10 ** (-60 / 20)
        idx = np.nonzero(level > thresh)[0]
        if len(idx):
            x = x[max(0, idx[0] - 40) : min(len(x), idx[-1] + n_of(0.05))]
    x = fade(x, fin, fout)
    m = np.max(np.abs(x)) + 1e-12
    return x * (10 ** (peak_db / 20) / m)
