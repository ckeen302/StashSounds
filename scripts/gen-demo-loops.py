#!/usr/bin/env python3
"""More demo loops (ticket 137): renders the demo's own MIDI patterns to audio loops.

Reads the patterns' notes (written by scripts/build-demo-loops.mjs from apps/web/src/demo/midi),
synthesizes each loop with numpy (electric piano, pluck, pad, bell, strings, 808 and drums, no
samples), folds the tails back into the start so the loop is seamless, then makes what the worker
makes for an upload: a two-pass loudnorm MP3 preview at limits.preview's bitrate and
limits.waveform.peakPoints peaks. Writes the previews to apps/web/public/demo/media/ and the
catalog entries to apps/web/src/demo/generated/more-loops.json.

Usage: python3 scripts/gen-demo-loops.py <patterns.json>   (needs numpy and ffmpeg)
"""
import base64
import hashlib
import json
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR = 44100
LIMITS = json.loads((ROOT / "packages/contracts/limits.json").read_text())
MEDIA = ROOT / "apps/web/public/demo/media"
OUT = ROOT / "apps/web/src/demo/generated/more-loops.json"
WORK = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/tmp/stash-demo-loops")

rng = np.random.default_rng(137)
NOISE = rng.uniform(-1, 1, SR * 3).astype(np.float64)


def hz(p):
    return 440.0 * 2 ** ((p - 69) / 12)


def env_adsr(n, a, d, s, r_start, r):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = t >= r_start
    e[rel] = e[rel] * np.exp(-(t[rel] - r_start) / max(r, 1e-4))
    return e


def saw(f, t, harmonics, vib=None):
    """A band-limited saw at f (scalar); vib, if given, scales the frequency over time."""
    phase = 2 * np.pi * (np.cumsum(f * vib) / SR if vib is not None else f * t)
    out = np.zeros_like(t)
    for k in range(1, harmonics + 1):
        if f * k > SR / 2.2:
            break
        out += np.sin(k * phase) / k
    return out


def voice(sound, p, dur, vel):
    f = hz(p)
    tail = {"keys": 0.5, "pluck": 0.4, "pad": 0.9, "bell": 1.4, "strings": 0.7, "bass": 0.2, "808": 0.25}.get(sound, 0.4)
    n = int((dur + tail) * SR)
    t = np.arange(n) / SR
    v = (vel / 127) ** 1.3
    if sound == "keys":
        e = env_adsr(n, 0.004, 0.9, 0.25, dur, 0.25)
        tine = np.sin(2 * np.pi * f * t + 1.2 * np.exp(-t * 9) * np.sin(2 * np.pi * f * 14 * t))
        x = tine + 0.3 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3) + 0.1 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 6)
        return 0.32 * v * e * x
    if sound == "pluck":
        x = np.zeros_like(t)
        for k in range(1, 14):
            if f * k > SR / 2.2:
                break
            x += np.sin(2 * np.pi * f * k * (1 + 0.0007 * k) * t) / k * np.exp(-t * (3 + 2.2 * k))
        return 0.42 * v * x * env_adsr(n, 0.002, 10, 1, dur, 0.12)
    if sound == "pad":
        x = sum(saw(f * d, t, 9) for d in (0.996, 1.0, 1.004)) / 3
        return 0.13 * v * x * env_adsr(n, 0.25, 1.5, 0.8, dur, 0.5)
    if sound == "bell":
        x = np.sin(2 * np.pi * f * t + 2.2 * np.exp(-t * 3.5) * np.sin(2 * np.pi * 3.5 * f * t))
        return 0.3 * v * x * np.exp(-t * 2.0) * env_adsr(n, 0.002, 10, 1, dur + 0.6, 0.4)
    if sound == "strings":
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t / 0.4, 0, 1)
        x = sum(saw(f * d, t, 8, vib) for d in (0.995, 1.002, 1.006)) / 3
        return 0.14 * v * x * env_adsr(n, 0.12, 1.0, 0.85, dur, 0.4)
    if sound in ("808", "bass"):
        fs = f * (1 + 1.2 * np.exp(-t * 60))
        ph = 2 * np.pi * np.cumsum(fs) / SR
        x = np.tanh(1.8 * np.sin(ph)) / np.tanh(1.8)
        return 0.55 * v * x * env_adsr(n, 0.003, 10, 1, dur, 0.08)
    return np.zeros(1)


def noise(n, off=0):
    return NOISE[off : off + n] if off + n <= len(NOISE) else np.resize(NOISE, n)


def drum(p, vel):
    v = (vel / 127) ** 1.2
    if p in (35, 36):
        n = int(0.5 * SR)
        t = np.arange(n) / SR
        fs = 48 + 110 * np.exp(-t * 30)
        x = np.sin(2 * np.pi * np.cumsum(fs) / SR) * np.exp(-t * 6.5) + 0.3 * noise(n) * np.exp(-t * 300)
        return 0.9 * v * np.tanh(1.4 * x)
    if p in (38, 40):
        n = int(0.3 * SR)
        t = np.arange(n) / SR
        nz = np.diff(noise(n + 1, 1000))
        return 0.55 * v * (0.8 * nz * np.exp(-t * 16) + 0.6 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25))
    if p == 39:
        n = int(0.3 * SR)
        t = np.arange(n) / SR
        nz = np.diff(noise(n + 1, 3000))
        e = sum(np.where(t >= d, np.exp(-(t - d) * (90 if d < 0.02 else 14)), 0) for d in (0, 0.011, 0.022))
        return 0.5 * v * nz * e
    if p == 37:
        n = int(0.08 * SR)
        t = np.arange(n) / SR
        return 0.35 * v * (np.sin(2 * np.pi * 1700 * t) + 0.5 * np.diff(noise(n + 1, 5000))) * np.exp(-t * 60)
    if p in (42, 44, 46):
        dec = 9 if p == 46 else 55
        n = int((0.45 if p == 46 else 0.09) * SR)
        t = np.arange(n) / SR
        nz = np.diff(np.diff(noise(n + 2, 7000)))
        return 0.22 * v * nz * np.exp(-t * dec)
    if p in (49, 55, 57):
        n = int(1.6 * SR)
        t = np.arange(n) / SR
        return 0.16 * v * np.diff(noise(n + 1, 9000)) * np.exp(-t * 2.4)
    if p in (51, 59):
        n = int(0.8 * SR)
        t = np.arange(n) / SR
        return 0.1 * v * (np.diff(noise(n + 1, 11000)) + 0.3 * np.sin(2 * np.pi * 3100 * t)) * np.exp(-t * 4)
    if 41 <= p <= 50:
        n = int(0.4 * SR)
        t = np.arange(n) / SR
        f0 = 80 + (p - 41) * 22
        fs = f0 * (1 + 0.6 * np.exp(-t * 25))
        return 0.6 * v * np.sin(2 * np.pi * np.cumsum(fs) / SR) * np.exp(-t * 7)
    n = int(0.1 * SR)
    return 0.2 * v * noise(n, 13000) * np.exp(-np.arange(n) / SR * 40)


def reverb_ir(seconds=1.3, seed=7):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    return r.uniform(-1, 1, n) * np.exp(-t * 4.5) * 0.06


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:n]


def render_layer(notes, sound, bpm, total, drums):
    spb = 60 / bpm
    buf = np.zeros(total)
    for start, length, pitch, vel in notes:
        at = int(round(start * spb * SR))
        x = drum(pitch, vel) if drums or sound == "drums" else voice(sound, pitch, length * spb, vel)
        buf[at : at + len(x)] += x[: len(buf) - at]
    return buf


def render(spec, patterns):
    bpm = spec["bpm"]
    bars = spec["bars"]
    loop_len = int(round(bars * 4 * 60 / bpm * SR))
    left = np.zeros(loop_len * 2 + SR * 4)
    right = np.zeros_like(left)
    for layer in spec["layers"]:
        pat = patterns[layer["id"]]
        notes = pat["notes"]["notes"]
        # Repeat a shorter pattern to fill the loop.
        pat_beats = pat["notes"]["bars"] * 4
        reps = max(1, math.ceil(bars * 4 / pat_beats))
        notes = [[s + r * pat_beats, l, p, v] for r in range(reps) for s, l, p, v in notes if s + r * pat_beats < bars * 4]
        sound = layer.get("sound", pat["sound"])
        drums = pat["notes"]["drums"]
        dry = render_layer(notes, sound, bpm, len(left), drums) * layer.get("gain", 1.0)
        wet = 0.0 if drums or sound in ("808", "bass") else layer.get("verb", 0.22)
        left += dry
        right += dry
        if wet:
            left += wet * convolve(dry, reverb_ir(1.3, 7))[: len(left)]
            right += wet * convolve(dry, reverb_ir(1.3, 8))[: len(right)]
    # Fold everything past the loop end back onto its start, so the loop repeats without a seam.
    out = []
    for ch in (left, right):
        y = np.zeros(loop_len)
        for k in range(0, len(ch), loop_len):
            seg = ch[k : k + loop_len]
            y[: len(seg)] += seg
        out.append(y)
    st = np.stack(out, axis=1)
    st = np.tanh(st * 1.1) / np.tanh(1.1)
    st *= 0.89 / max(1e-6, np.max(np.abs(st)))
    return st, loop_len


def write_wav(path, st):
    data = (np.clip(st, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def ffmpeg(args, capture=False):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-threads", "1", *args], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[-2000:])
    return r


def loudnorm(src):
    ln = LIMITS["loudness"]
    r = ffmpeg(["-i", str(src), "-af", f"loudnorm=I={ln['targetLufs']}:TP={ln['truePeakDb']}:LRA=50:print_format=json", "-f", "null", "-"])
    err = r.stderr.decode()
    j = json.loads(err[err.rindex("{") : err.rindex("}") + 1])
    return (
        f"loudnorm=I={ln['targetLufs']}:TP={ln['truePeakDb']}:LRA=50"
        f":measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}"
        f":measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true"
    )


def peaks(mp3, points):
    r = ffmpeg(["-i", str(mp3), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture=True)
    s = np.abs(np.frombuffer(r.stdout, dtype="<f4"))
    n = len(s)
    out = bytes(min(255, round(float(np.max(s[(i * n) // points : max((i * n) // points + 1, ((i + 1) * n) // points)])) * 255)) for i in range(points))
    return base64.b64encode(out).decode()


def main():
    patterns = {p["publicId"]: p for p in json.loads(Path(sys.argv[1]).read_text())}
    specs = json.loads((ROOT / "scripts/demo-loops.json").read_text())
    MEDIA.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    result = []
    pv = LIMITS["preview"]
    for spec in specs:
        st, loop_len = render(spec, patterns)
        wav = WORK / f"{spec['slug']}.wav"
        write_wav(wav, st)
        duration_ms = round(loop_len / SR * 1000)
        kbps = pv["loopBitrateKbpsShort"] if duration_ms <= pv["loopShortMaxMs"] else pv["loopBitrateKbpsLong"]
        mp3 = MEDIA / f"{spec['slug']}.mp3"
        ffmpeg(["-i", str(wav), "-af", f"{loudnorm(wav)},aresample={SR}", "-ar", str(SR), "-ac", "2", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-f", "mp3", "-y", str(mp3)])
        size = mp3.stat().st_size
        if size > pv["loopMaxBytes"]:
            raise RuntimeError(f"{spec['slug']}: {size} B over limits.preview.loopMaxBytes")
        copy = {k: spec[k] for k in ("title", "owner", "tags", "genre", "reference", "description", "license", "likes", "downloads", "publishedAt")}
        result.append({
            "slug": spec["slug"], "bpm": spec["bpm"], "bars": spec["bars"], "key": spec["key"], "loopSamples": loop_len, "sampleRate": SR,
            "durationMs": duration_ms,
            "preview": {"path": f"demo/media/{spec['slug']}.mp3", "bytes": size, "sha256": hashlib.sha256(mp3.read_bytes()).hexdigest(), "kbps": kbps},
            "peaks": peaks(mp3, LIMITS["waveform"]["peakPoints"]),
            "copy": copy,
        })
        print(f"{spec['slug']}: {spec['bpm']} BPM, {spec['bars']} bars, {duration_ms} ms, {size} B")
    OUT.write_text(json.dumps({"$comment": "Generated by scripts/gen-demo-loops.py from scripts/demo-loops.json. Do not edit.", "loops": result}, indent=2) + "\n")
    print(f"wrote {len(result)} loops")


if __name__ == "__main__":
    main()
