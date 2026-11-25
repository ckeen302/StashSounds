"""Signal processing for the demo's loop library (scripts/loops). numpy and scipy only.

Everything works on float64 arrays at SR. Stereo signals are shaped (n, 2).
"""
import math

import numpy as np
from scipy import signal

SR = 44100
# The loop length in samples while a loop renders: modulation (chorus, tape wobble) is made periodic
# over it, so the loop's end meets its start without a jump in delay time.
PERIOD = None


def _q(rate):
    """A modulation rate rounded so a whole number of cycles fits in the loop."""
    if not PERIOD:
        return rate
    cycles = max(1, round(rate * PERIOD / SR))
    return cycles * SR / PERIOD
_rng = np.random.default_rng(20261125)


def rng(seed):
    return np.random.default_rng(seed)


def hz(p):
    return 440.0 * 2 ** ((p - 69) / 12)


def stereo(x, pan=0.0):
    """Mono to stereo with an equal-power pan (-1 left, 1 right)."""
    if x.ndim == 2:
        if pan == 0:
            return x
        a = (pan + 1) * math.pi / 4
        return np.stack([x[:, 0] * math.cos(a) * 1.4142, x[:, 1] * math.sin(a) * 1.4142], axis=1)
    a = (pan + 1) * math.pi / 4
    return np.stack([x * math.cos(a), x * math.sin(a)], axis=1) * 1.4142


def add(dst, src, at):
    """Mixes src into dst starting at sample `at`, clipping to dst's length."""
    at = int(at)
    if at >= len(dst):
        return
    if at < 0:
        src = src[-at:]
        at = 0
    n = min(len(src), len(dst) - at)
    dst[at : at + n] += src[:n]


# ---------- filters ----------


def _sos(kind, f, q=0.707, order=2):
    f = float(np.clip(f, 20, SR / 2.05))
    if kind in ("lp", "hp"):
        return signal.butter(order, f, btype="low" if kind == "lp" else "high", fs=SR, output="sos")
    raise ValueError(kind)


def lp(x, f, order=2):
    return signal.sosfilt(_sos("lp", f, order=order), x, axis=0)


def hp(x, f, order=2):
    return signal.sosfilt(_sos("hp", f, order=order), x, axis=0)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [max(20, lo), min(hi, SR / 2.05)], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def _biquad(kind, f, gain_db=0.0, q=0.707):
    A = 10 ** (gain_db / 40)
    w = 2 * math.pi * min(f, SR / 2.05) / SR
    cw, sw = math.cos(w), math.sin(w)
    alpha = sw / (2 * q)
    if kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == "lowshelf":
        s = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + s), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - s)]
        a = [(A + 1) + (A - 1) * cw + s, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - s]
    elif kind == "highshelf":
        s = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + s), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - s)]
        a = [(A + 1) - (A - 1) * cw + s, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - s]
    elif kind == "lpq":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bpq":
        b = [alpha, 0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    else:
        raise ValueError(kind)
    return np.array(b) / a[0], np.array(a) / a[0]


def eq(x, kind, f, gain_db=0.0, q=0.707):
    b, a = _biquad(kind, f, gain_db, q)
    return signal.lfilter(b, a, x, axis=0)


def sweep_lp(x, cut_start, cut_end, curve_t, q=0.9, block=256):
    """A resonant lowpass whose cutoff moves from cut_start to cut_end with time constant curve_t (s)."""
    out = np.zeros_like(x)
    zi = None
    n = len(x)
    for i in range(0, n, block):
        t = i / SR
        f = cut_end + (cut_start - cut_end) * math.exp(-t / max(curve_t, 1e-4))
        b, a = _biquad("lpq", f, q=q)
        seg = x[i : i + block]
        if zi is None:
            zi = np.zeros((2,) + seg.shape[1:])
        y, zi = signal.lfilter(b, a, seg, axis=0, zi=zi)
        out[i : i + block] = y
    return out


# ---------- oscillators ----------


def _polyblep(t, dt):
    dt = np.broadcast_to(np.asarray(dt, dtype=float), t.shape)
    y = np.zeros_like(t)
    m = t < dt
    u = t[m] / dt[m]
    y[m] = u + u - u * u - 1
    m2 = t > 1 - dt
    u = (t[m2] - 1) / dt[m2]
    y[m2] = u * u + u + u + 1
    return y


def phase_of(freq, n, phase0=0.0):
    """Phase in cycles for a scalar or per-sample frequency."""
    if np.ndim(freq) == 0:
        return (phase0 + freq * np.arange(n) / SR) % 1.0, freq / SR
    ph = (phase0 + np.cumsum(freq) / SR) % 1.0
    return ph, freq / SR


def saw(freq, n, phase0=0.0):
    t, dt = phase_of(freq, n, phase0)
    return 2 * t - 1 - _polyblep(t, dt)


def square(freq, n, phase0=0.0, width=0.5):
    t, dt = phase_of(freq, n, phase0)
    s = np.where(t < width, 1.0, -1.0)
    s += _polyblep(t, dt)
    s -= _polyblep((t + 1 - width) % 1.0, dt)
    return s


def sine(freq, n, phase0=0.0):
    t, _ = phase_of(freq, n, phase0)
    return np.sin(2 * np.pi * t)


def tri(freq, n, phase0=0.0):
    t, _ = phase_of(freq, n, phase0)
    return 4 * np.abs(t - 0.5) - 1


def noise(n, seed=None):
    g = _rng if seed is None else rng(seed)
    return g.uniform(-1, 1, n)


# ---------- envelopes ----------


def adsr(n, a, d, s, rel_at, r):
    """Attack, decay to sustain level, release starting at rel_at seconds."""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rs = int(rel_at * SR)
    if rs < n:
        lvl = e[rs] if rs < n else 0
        e[rs:] = lvl * np.exp(-(t[rs:] - rel_at) / max(r, 1e-4))
    return e


def fade(x, fin=0.002, fout=0.01):
    n = len(x)
    a, b = int(fin * SR), int(fout * SR)
    e = np.ones(n)
    if a:
        e[: min(a, n)] = np.linspace(0, 1, min(a, n))
    if b:
        e[max(0, n - b) :] *= np.linspace(1, 0, n - max(0, n - b))
    return x * (e[:, None] if x.ndim == 2 else e)


# ---------- effects ----------

_IR_CACHE = {}


def reverb_ir(decay, predelay=0.012, bright=6000, size=1.0, seed=7):
    key = (round(decay, 3), round(predelay, 4), bright, size, seed)
    if key in _IR_CACHE:
        return _IR_CACHE[key]
    g = rng(seed)
    n = int(SR * (decay * 1.6 + predelay))
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    pre = int(predelay * SR)
    for c in range(2):
        x = g.standard_normal(n)
        # Darker as it decays: a bright and a dark copy crossfaded over time.
        dark = lp(x, bright * 0.25)
        brt = lp(x, bright)
        w = np.exp(-t / (decay * 0.35))
        y = brt * w + dark * (1 - w)
        y *= np.exp(-6.9 * t / decay)
        # Early reflections.
        for k, (dt, gain) in enumerate([(0.007, 0.5), (0.013, 0.35), (0.021, 0.3), (0.029, 0.22), (0.037, 0.18)]):
            i = int((dt * size + 0.003 * c * (k % 2)) * SR)
            if i < n:
                y[i] += gain * (1 if (k + c) % 2 else -1) * 3
        y = np.concatenate([np.zeros(pre), y[: n - pre]])
        ir[:, c] = y
    ir = hp(ir, 180)
    ir /= np.sqrt(np.sum(ir**2) / 2)
    _IR_CACHE[key] = ir
    return ir


def reverb(x, mix=0.25, decay=2.2, predelay=0.015, bright=6500, width=1.0):
    """Convolution reverb with a generated hall: returns dry plus wet."""
    x = stereo(x) if x.ndim == 1 else x
    ir = reverb_ir(decay, predelay, bright)
    wet = np.stack([signal.fftconvolve(x[:, 0], ir[:, 0])[: len(x)], signal.fftconvolve(x[:, 1], ir[:, 1])[: len(x)]], axis=1)
    if width != 1.0:
        m = (wet[:, 0] + wet[:, 1]) / 2
        s = (wet[:, 0] - wet[:, 1]) / 2 * width
        wet = np.stack([m + s, m - s], axis=1)
    return x + wet * mix


def delay(x, time_s, feedback=0.35, mix=0.25, ping_pong=True, tone=4500, repeats=8):
    x = stereo(x) if x.ndim == 1 else x
    out = x.copy()
    d = int(time_s * SR)
    tap = x.copy()
    for k in range(1, repeats + 1):
        tap = lp(tap, tone) * feedback if k > 1 else lp(tap, tone)
        if ping_pong:
            tap = tap[:, ::-1]
        shifted = np.zeros_like(x)
        if k * d < len(x):
            shifted[k * d :] = tap[: len(x) - k * d]
        out += shifted * mix
        if np.max(np.abs(tap)) < 1e-4:
            break
    return out


def chorus(x, depth_ms=3.0, rate=0.6, mix=0.45, base_ms=12.0):
    x = stereo(x) if x.ndim == 1 else x
    n = len(x)
    t = np.arange(n) / SR
    out = x.copy()
    rate = _q(rate)
    for c, ph in ((0, 0.0), (1, math.pi / 2)):
        d = (base_ms + depth_ms * np.sin(2 * np.pi * rate * t + ph)) * SR / 1000
        idx = np.arange(n) - d
        out[:, c] = x[:, c] * (1 - mix * 0.5) + np.interp(idx, np.arange(n), x[:, c], left=0) * mix
    return out


def wobble(x, depth_ms=1.2, rate=0.55, flutter_ms=0.15, flutter_rate=7.5, seed=3):
    """Tape wow and flutter: a slowly moving delay."""
    x = stereo(x) if x.ndim == 1 else x
    n = len(x)
    t = np.arange(n) / SR
    rate, flutter_rate = _q(rate), _q(flutter_rate)
    # Slow random drift, made of a few sines that repeat with the loop.
    g = rng(seed)
    drift = np.zeros(n)
    for k in (3, 5, 7):
        drift += np.sin(2 * np.pi * _q(rate * k / 4.0) * t + g.uniform(0, 6.28)) / k
    drift *= 0.5
    d = (depth_ms * (1 + np.sin(2 * np.pi * rate * t) + drift) + flutter_ms * np.sin(2 * np.pi * flutter_rate * t) + depth_ms * 2) * SR / 1000
    idx = np.arange(n) - d
    return np.stack([np.interp(idx, np.arange(n), x[:, c], left=0) for c in range(2)], axis=1)


def saturate(x, drive=2.0, mix=1.0):
    y = np.tanh(x * drive) / np.tanh(drive)
    return x * (1 - mix) + y * mix


def bitcrush(x, bits=10, down=2):
    q = 2 ** (bits - 1)
    y = np.round(x * q) / q
    if down > 1:
        y = np.repeat(y[::down], down, axis=0)[: len(x)]
    return y


def vinyl(n, amount=0.5, seed=11):
    g = rng(seed)
    hiss = lp(hp(g.standard_normal(n), 2000), 9000) * 0.012
    crackle = np.zeros(n)
    k = int(n / SR * 18 * amount) + 1
    pos = g.integers(0, n, k)
    crackle[pos] = g.uniform(-1, 1, k) * g.uniform(0.2, 1, k) ** 3
    crackle = hp(crackle, 1500) * 0.35
    rumble = lp(g.standard_normal(n), 60) * 0.02
    mono = (hiss + crackle + rumble) * amount
    return np.stack([mono, np.roll(mono, 37) * 0.9 + hiss * 0.1], axis=1)


def width(x, amount=1.3):
    m = (x[:, 0] + x[:, 1]) / 2
    s = (x[:, 0] - x[:, 1]) / 2 * amount
    return np.stack([m + s, m - s], axis=1)


def haas(x, ms=12, pan_side=1):
    x = stereo(x) if x.ndim == 1 else x
    d = int(ms * SR / 1000)
    y = x.copy()
    c = 1 if pan_side > 0 else 0
    y[d:, c] = x[:-d, c]
    y[:d, c] = 0
    return y


def compress(x, thresh_db=-18, ratio=3.0, attack=0.005, release=0.12, makeup_db=0.0, knee=6.0):
    mono = np.max(np.abs(x), axis=1) if x.ndim == 2 else np.abs(x)
    # Envelope follower: fast attack, slow release (two one-pole filters, max of both paths).
    a_att = math.exp(-1 / (attack * SR))
    a_rel = math.exp(-1 / (release * SR))
    env_rel = signal.lfilter([1 - a_rel], [1, -a_rel], mono)
    env_att = signal.lfilter([1 - a_att], [1, -a_att], mono)
    env = np.maximum(env_rel, env_att * 0.9)
    db = 20 * np.log10(env + 1e-9)
    over = db - thresh_db
    gain_db = np.where(over <= -knee / 2, 0, np.where(over >= knee / 2, -(over) * (1 - 1 / ratio), -((over + knee / 2) ** 2) / (2 * knee) * (1 - 1 / ratio)))
    g = 10 ** ((gain_db + makeup_db) / 20)
    return x * (g[:, None] if x.ndim == 2 else g)


def duck(x, hits_s, depth=0.6, release=0.18, total=None):
    """Sidechain: pulls x down at each kick time and lets it come back over `release` seconds."""
    n = len(x)
    g = np.ones(n)
    t = np.arange(n) / SR
    for h in hits_s:
        i = int(h * SR)
        if i >= n:
            continue
        seg = t[i:] - h
        g[i:] = np.minimum(g[i:], 1 - depth * np.exp(-seg / release) * np.clip(seg / 0.003, 0, 1) - 0 * seg)
    return x * (g[:, None] if x.ndim == 2 else g)


def limit(x, ceiling=0.95, drive=1.0):
    """A soft clipper used as the last stage before loudness normalization."""
    peak = np.max(np.abs(x)) + 1e-9
    x = x / peak * drive
    return np.tanh(x * 1.2) / np.tanh(1.2) * ceiling


def resample(x, ratio):
    """Plays x at `ratio` times speed (pitch up for ratio > 1), linear interpolation."""
    n = int(len(x) / ratio)
    if n <= 1:
        return x[:1]
    idx = np.arange(n) * ratio
    if x.ndim == 2:
        return np.stack([np.interp(idx, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], axis=1)
    return np.interp(idx, np.arange(len(x)), x)
