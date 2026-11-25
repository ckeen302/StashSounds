"""Writes the loop library: musical parts (chords, melodies, arps, 808s, drums) built on the demo's own
chord packs (apps/web/src/demo/midi/chord-packs), arranged per style into loop specs for render.py.

Every note is in the progression's key and every chord is the pack's own voicing, so the BPM and key
each loop is tagged with are the ones it was written in.
"""
import json
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PACKS = ROOT / "apps/web/src/demo/midi/chord-packs"
PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11}
MINOR = [0, 2, 3, 5, 7, 8, 10]
MAJOR = [0, 2, 4, 5, 7, 9, 11]


def load_progressions():
    out = []
    for f in sorted(PACKS.glob("*.json")):
        d = json.loads(f.read_text())
        style = {p["name"]: p["style"] for p in d["packs"]}
        for p in d["progressions"]:
            p = dict(p)
            p["file"] = f.stem
            p["packStyle"] = style.get(p["pack"], f.stem)
            out.append(p)
    return out


def parse_key(k):
    root, mode = k.split()
    return PC[root], mode


class Prog:
    def __init__(self, p):
        self.p = p
        self.title = p["title"]
        self.bpm = p["bpm"]
        self.root, self.mode = parse_key(p["key"])
        self.scale = sorted((self.root + i) % 12 for i in (MINOR if self.mode == "minor" else MAJOR))
        self.chords = []
        t = 0.0
        for sym, beats, notes in p["chords"]:
            self.chords.append((t, beats, sym, notes))
            t += beats
        self.beats = t
        self.bars = int(t // 4)
        self.top = p.get("top") or []

    def chord_at(self, b):
        b = b % self.beats
        for c in self.chords:
            if c[0] <= b < c[0] + c[1]:
                return c
        return self.chords[-1]

    def tones(self, b):
        return sorted({n % 12 for n in self.chord_at(b)[3][1:]} | {self.chord_at(b)[3][0] % 12})

    def in_scale(self, p):
        return p % 12 in self.scale

    def symbols(self):
        seen = []
        for c in self.chords:
            if not seen or seen[-1] != c[2]:
                seen.append(c[2])
        return seen


def fit(p, lo, hi):
    while p < lo:
        p += 12
    while p > hi:
        p -= 12
    return p


def nearest(pcs, target, lo=0, hi=127):
    best = None
    for o in range(-2, 3):
        for pc in pcs:
            cand = (target // 12 + o) * 12 + pc
            if lo <= cand <= hi and (best is None or abs(cand - target) < abs(best - target)):
                best = cand
    return best if best is not None else target


def scale_step(prog, p, steps):
    """Moves p by `steps` scale degrees (p snapped into the scale first)."""
    sc = prog.scale
    if p % 12 not in sc:
        p = nearest(sc, p)
    deg = [(p // 12) * 12 + s for s in sc]
    i = deg.index(p)
    j = i + steps
    octv, k = divmod(j, 7)
    return (p // 12 + octv) * 12 + sc[k]


# ---------- chord parts ----------


def chord_part(prog, rhythm, lo=48, hi=84, vel=92, bass=False, bass_oct=None, strum=0.0, octave=0, drop_top=False, length=1.0):
    notes = []
    for (s, beats, sym, voicing) in prog.chords:
        up = [n + octave for n in voicing[1:]]
        while min(up) < lo:
            up = [n + 12 for n in up]
        while max(up) > hi:
            up = [n - 12 for n in up]
        if drop_top and len(up) > 3:
            up = up[:-1]
        hits = _rhythm(rhythm, s, beats)
        for (hs, hl, hv) in hits:
            for k, n in enumerate(up):
                notes.append((hs + k * strum, max(0.1, hl * length - k * strum), n, int(vel * hv)))
        if bass:
            b = voicing[0]
            b = fit(b, *(bass_oct or (36, 52)))
            notes.append((s, beats * 0.98, b, int(vel * 0.9)))
    return notes


def _rhythm(rhythm, s, beats):
    out = []
    if rhythm == "held":
        out.append((s, beats - 0.04, 1.0))
    elif rhythm == "roll":
        out.append((s, beats - 0.04, 1.0))
    elif rhythm == "push":
        out.append((max(0, s - 0.5) if s > 0 else s, beats - 0.04 + (0.5 if s > 0 else 0), 1.0))
    elif rhythm == "stabs":
        for b in range(int(beats // 4) or 1):
            base = s + b * 4
            for off, ln, v in ((0, 0.5, 1.0), (0.75, 0.25, 0.7), (1.5, 0.5, 0.85), (2.5, 0.5, 0.8), (3.25, 0.5, 0.7)):
                if off < beats:
                    out.append((base + off, ln, v))
    elif rhythm == "pulse":
        k = 0
        while k * 0.5 < beats - 0.01:
            out.append((s + k * 0.5, 0.42, 1.0 if k % 2 == 0 else 0.75))
            k += 1
    elif rhythm == "bounce":
        for b in range(int(beats // 4) or 1):
            base = s + b * 4
            for off, ln, v in ((0, 1.4, 1.0), (1.5, 0.45, 0.75), (2, 1.4, 0.95), (3.5, 0.45, 0.75)):
                if off < beats:
                    out.append((base + off, ln, v))
    elif rhythm == "halves":
        k = 0
        while k * 2 < beats - 0.01:
            out.append((s + k * 2, 1.9, 1.0 if k % 2 == 0 else 0.85))
            k += 1
    else:
        out.append((s, beats - 0.04, 1.0))
    return out


def arp(prog, rate=0.25, pattern="up", lo=60, hi=96, vel=85, octaves=2, gate=0.9, rng=None, accent=True):
    """Breaks each chord's upper voicing into a repeating figure."""
    notes = []
    for (s, beats, sym, voicing) in prog.chords:
        up = sorted(set(voicing[1:]))
        while min(up) < lo:
            up = [n + 12 for n in up]
        pool = []
        for o in range(octaves):
            pool += [n + 12 * o for n in up if n + 12 * o <= hi]
        pool = sorted(set(pool))
        if pattern == "up":
            seq = pool
        elif pattern == "updown":
            seq = pool + pool[-2:0:-1]
        elif pattern == "down":
            seq = pool[::-1]
        elif pattern == "skip":
            seq = [pool[i] for i in (0, 2, 1, 3, 2, 4, 3, 1) if i < len(pool)]
        elif pattern == "pedal":
            top = pool[-1]
            seq = []
            for n in pool[:-1]:
                seq += [n, top]
        elif pattern == "triplet":
            seq = pool[:3] + pool[1:4]
        else:
            seq = pool
        k = 0
        while k * rate < beats - 1e-6:
            n = seq[k % len(seq)]
            on = (k * rate) % 1 < 1e-6
            notes.append((s + k * rate, rate * gate, n, int(vel * (1.0 if on and accent else 0.8))))
            k += 1
    return notes


# ---------- melodies ----------

CELLS = {
    # (start beat within a 2-bar phrase, length in beats)
    "trap": [
        [(0, 0.75), (0.75, 0.75), (1.5, 0.5), (2, 1.5), (4, 0.75), (4.75, 0.75), (5.5, 0.5), (6, 1.75)],
        [(0, 1.5), (1.5, 0.5), (2, 0.5), (2.5, 1.5), (4.5, 0.5), (5, 0.5), (5.5, 0.5), (6, 2)],
        [(0, 0.5), (0.5, 0.5), (1, 1), (2.5, 0.5), (3, 1), (4, 0.5), (4.5, 0.5), (5, 1), (6, 2)],
        [(0.5, 0.5), (1, 0.5), (1.5, 1.5), (3, 1), (4.5, 0.5), (5, 0.5), (5.5, 1), (6.5, 1.5)],
    ],
    "flute": [
        [(0, 1.5), (1.5, 0.25), (1.75, 0.25), (2, 2), (4, 0.75), (4.75, 0.75), (5.5, 2.5)],
        [(0, 0.75), (0.75, 0.75), (1.5, 2.5), (4, 0.5), (4.5, 0.5), (5, 0.5), (5.5, 2.5)],
        [(0.5, 0.5), (1, 0.5), (1.5, 0.5), (2, 2), (4.5, 0.5), (5, 0.5), (5.5, 0.5), (6, 2)],
    ],
    "plugg": [
        [(0, 0.5), (0.5, 0.5), (1, 0.5), (1.5, 1), (3, 0.5), (3.5, 0.5), (4, 0.5), (4.5, 0.5), (5, 1), (6, 0.5), (6.5, 1.5)],
        [(0, 0.75), (0.75, 0.75), (1.5, 0.5), (2, 0.5), (2.5, 1.5), (4, 0.75), (4.75, 0.75), (5.5, 0.5), (6, 2)],
        [(0, 0.5), (1, 0.5), (1.5, 0.5), (2, 1), (3, 0.5), (3.5, 0.5), (4, 0.5), (5, 0.5), (5.5, 0.5), (6, 2)],
    ],
    "rnb": [
        [(0.5, 1), (1.5, 0.5), (2, 1.5), (4, 0.33), (4.33, 0.33), (4.67, 0.83), (5.5, 2.5)],
        [(0, 1.5), (1.5, 0.5), (2, 0.5), (2.5, 1.5), (4.5, 1), (5.5, 0.5), (6, 2)],
        [(0.67, 0.33), (1, 1), (2, 2), (4.67, 0.33), (5, 0.5), (5.5, 0.5), (6, 2)],
    ],
    "drill": [
        [(0, 0.67), (0.67, 0.67), (1.33, 0.67), (2, 1.33), (3.33, 0.67), (4, 0.67), (4.67, 0.67), (5.33, 0.67), (6, 2)],
        [(0, 1), (1, 0.33), (1.33, 0.33), (1.67, 0.33), (2, 2), (4, 1), (5, 0.33), (5.33, 0.33), (5.67, 0.33), (6, 2)],
        [(0, 0.75), (0.75, 0.75), (1.5, 1.5), (3, 1), (4, 0.75), (4.75, 0.75), (5.5, 2.5)],
    ],
    "rage": [
        [(i * 0.5, 0.4) for i in range(16)],
        [(0, 0.5), (0.5, 0.5), (1, 0.25), (1.25, 0.25), (1.5, 0.5), (2, 0.5), (2.5, 0.5), (3, 1), (4, 0.5), (4.5, 0.5), (5, 0.25), (5.25, 0.25), (5.5, 0.5), (6, 0.5), (6.5, 0.5), (7, 1)],
        [(0, 0.75), (0.75, 0.75), (1.5, 0.5), (2, 0.75), (2.75, 0.75), (3.5, 0.5), (4, 0.75), (4.75, 0.75), (5.5, 0.5), (6, 0.75), (6.75, 0.75), (7.5, 0.5)],
    ],
    "lofi": [
        [(0.5, 0.5), (1, 1), (2, 0.5), (2.5, 1.5), (4.5, 0.5), (5, 1), (6, 2)],
        [(0, 0.67), (0.67, 0.33), (1, 1.5), (3, 1), (4, 0.67), (4.67, 0.33), (5, 3)],
    ],
}


def melody(prog, cells, rng, lo=67, hi=86, vel=96, contour="arch", start=None):
    """A hook: a two-bar phrase, answered, repeated over the loop, landing on chord tones."""
    cell = cells[rng.integers(len(cells))]
    phrases = int(prog.beats // 8) or 1
    center = (lo + hi) // 2
    cur = nearest(prog.tones(0), start or center - 2, lo, hi)

    def make(offset, seed_pitch, ending):
        out = []
        p = seed_pitch
        for i, (s, ln) in enumerate(cell):
            b = offset + s
            strong = abs(s - round(s)) < 1e-6 and int(round(s)) % 2 == 0
            if i > 0:
                frac = i / len(cell)
                bias = 1 if (contour == "arch" and frac < 0.5) or contour == "up" else -1
                step = rng.choice([0, 1, 1, 2, -1, -1, -2, 3, -3], p=[0.12, 0.2, 0.08, 0.1, 0.2, 0.1, 0.08, 0.06, 0.06])
                step = abs(step) * bias if rng.random() < 0.65 else step
                p = scale_step(prog, p, int(step))
                if p > hi:
                    p = scale_step(prog, p, -2 - int(rng.integers(3)))
                if p < lo:
                    p = scale_step(prog, p, 2 + int(rng.integers(3)))
            if strong or ln >= 1.5:
                p = nearest(prog.tones(b), p, lo, hi)
            elif not prog.in_scale(p):
                p = nearest(prog.scale, p, lo, hi)
            out.append([b, ln, p, int(vel * (1.0 if strong else 0.86))])
        if ending:
            # Land the last note on the root or fifth of the chord under it.
            last = out[-1]
            ch = prog.chord_at(last[0])[3]
            root = ch[0] % 12
            last[2] = nearest([root, (root + 7) % 12] if (root + 7) % 12 in prog.tones(last[0]) else [root], last[2], lo, hi)
        return out

    a = make(0, cur, False)
    notes = []
    for k in range(phrases):
        off = k * 8
        if k % 2 == 0:
            # The statement, re-fitted to the chords under it.
            for (b, ln, p, v) in a:
                bb = b + off
                strong = abs(b - round(b)) < 1e-6
                q = nearest(prog.tones(bb), p, lo, hi) if strong else (p if prog.in_scale(p) else nearest(prog.scale, p, lo, hi))
                notes.append((bb, ln, q, v))
        else:
            # The answer: same rhythm, the first half echoed, a new ending.
            ans = make(off, a[0][2], True)
            half = len(a) // 2
            for i, (b, ln, p, v) in enumerate(ans):
                if i < half:
                    q = a[i][2]
                    q = nearest(prog.tones(b), q, lo, hi) if abs(a[i][0] - round(a[i][0])) < 1e-6 else q
                    notes.append((b, ln, q, v))
                else:
                    notes.append((b, ln, p, v))
    return notes


def top_line(prog, lo=60, hi=96, octave=0, vel=96):
    out = []
    for s, ln, p in prog.top:
        out.append((s, ln, fit(p + octave, lo, hi), vel))
    return out


def lead_line(prog, style, rng, lo, hi, vel=96):
    """The pack's own top line when it has one (written with the chords), otherwise a written hook."""
    if prog.top and len(prog.top) >= 5 and rng.random() < 0.6:
        oct_ = 0
        mid = np.mean([p for _, _, p in prog.top])
        while mid + oct_ < lo + 3:
            oct_ += 12
        while mid + oct_ > hi - 3:
            oct_ -= 12
        line = top_line(prog, lo, hi, oct_, vel)
        # The top line covers the first statement; repeat it across the loop when it is short.
        span = max(s + ln for s, ln, _, _ in line)
        if span <= prog.beats / 2 + 0.01:
            line = line + [(s + prog.beats / 2, ln, p, v) for s, ln, p, v in line]
        return line, True
    return melody(prog, CELLS[style], rng, lo, hi, vel), False


# ---------- 808 ----------


def bass808(prog, style, rng, lo=29, hi=43):
    notes = []
    for (s, beats, sym, voicing) in prog.chords:
        r = fit(voicing[0], lo, hi)
        fifth = fit(r + 7, lo, hi + 5)
        bars = max(1, int(beats // 4))
        for b in range(bars):
            base = s + b * 4
            span = min(4, beats)
            if style in ("trap", "flute"):
                pat = [(0, 1.5, r, 120, False), (1.75, 0.5, r, 100, False), (2.5, 1.5, r, 110, False)] if rng.random() < 0.6 else [(0, 2.5, r, 120, False), (2.75, 1.25, r + 12 if r + 12 <= hi + 12 else r, 105, True)]
            elif style == "drill":
                pat = [(0, 0.75, r, 120, False), (0.75, 1.0, r + 12, 110, True), (2, 0.5, r, 110, True), (2.67, 1.33, fifth, 110, True)]
            elif style == "plugg":
                pat = [(0, 1.0, r, 120, False), (1.5, 0.5, r, 100, False), (2.0, 0.75, r + 12, 105, True), (3.0, 1.0, r, 110, True)]
            elif style == "rage":
                pat = [(0, 0.75, r, 125, False), (0.75, 0.75, r, 115, False), (1.5, 1.0, r + 12, 118, True), (2.5, 0.5, r, 115, True), (3, 1, r, 118, False)]
            elif style == "rnb":
                pat = [(0, 2.5, r, 115, False), (2.75, 1.25, fifth, 100, True)]
            else:
                pat = [(0, 2, r, 115, False), (2.5, 1.5, r, 105, False)]
            for (o, ln, p, v, gl) in pat:
                if o < span:
                    notes.append((base + o, min(ln, span - o), p, v, gl))
    return notes


# ---------- drums ----------


def drums(style, bars, rng, fills=True):
    """Hits are (beat, name, velocity, args)."""
    h = []
    hat_tone = float(rng.uniform(0.95, 1.08))
    for bar in range(bars):
        B = bar * 4
        last = bar == bars - 1
        if style in ("trap", "flute", "plugg", "rage", "phonk"):
            # Half-time: the clap on beat 3 of each bar.
            kick_sets = {
                "trap": [[0, 1.75, 2.5], [0, 0.75, 2.5, 3.5], [0, 1.5, 2.75]],
                "flute": [[0, 1.75, 2.5], [0, 2.5, 3.25]],
                "plugg": [[0, 1.5, 2.5], [0, 0.75, 2.0, 3.5]],
                "rage": [[0, 0.75, 1.5, 2.5, 3.0], [0, 1, 1.75, 2.5]],
                "phonk": [[0, 0.75, 1.5, 2.5], [0, 1.75, 2.5, 3.5]],
            }[style]
            for k in kick_sets[int(rng.integers(len(kick_sets)))]:
                h.append((B + k, "kick", 118, {"type": "rage" if style == "rage" else "trap"}))
            h.append((B + 2, "clap", 112, {}))
            if style in ("trap", "flute", "rage"):
                h.append((B + 2, "snare", 80, {"type": "trap"}))
            if style == "plugg":
                h.append((B + 2, "snare", 70, {"type": "trap"}))
                if rng.random() < 0.4:
                    h.append((B + 3.75, "clap", 70, {}))
            # Hats: eighths or sixteenths, then a roll into the next bar.
            sub = 0.25 if style in ("rage", "trap") and rng.random() < 0.6 else 0.5
            t = 0.0
            while t < 4 - 1e-6:
                v = 92 if abs(t % 1) < 1e-6 else (70 if abs(t % 0.5) < 1e-6 else 60)
                h.append((B + t, "hat", v, {"tone": hat_tone, "pan": 0.15}))
                t += sub
            if fills and (bar % 2 == 1 or rng.random() < 0.35):
                kind = rng.choice(["trip", "32", "trip16"])
                a = 3.0 if kind != "32" else 3.5
                h = [x for x in h if not (x[1] == "hat" and B + a <= x[0] < B + 4)]
                step = {"trip": 1 / 3, "32": 0.125, "trip16": 1 / 6}[kind]
                t = a
                k = 0
                while t < 4 - 1e-6:
                    h.append((B + t, "hat", 60 + int(30 * (k % 3 == 0)) + k, {"tone": hat_tone * (1 + 0.03 * k if kind == "trip16" else 1), "pan": 0.15}))
                    t += step
                    k += 1
            if rng.random() < 0.3:
                h.append((B + 1.5, "ohat", 70, {"tone": hat_tone}))
            if style == "phonk":
                h += [(B + x, "cowbellreal", 75, {"n": 0}) for x in (0.5, 2.5)]
        elif style == "drill":
            k = [[0, 1.75], [0, 0.75, 2.5], [0, 2.75]][int(rng.integers(3))]
            for x in k:
                h.append((B + x, "kick", 115, {"type": "punch"}))
            h.append((B + 2, "snare", 110, {"type": "drill"}))
            h.append((B + 2, "clap", 80, {}))
            if bar % 2 == 1:
                h.append((B + 3.5, "snare", 95, {"type": "drill"}))
            # The skippy drill hat: triplet pushes around a straight grid.
            for x, v in ((0, 90), (0.5, 70), (1, 85), (1.5, 72), (1.833, 60), (2, 88), (2.5, 70), (2.833, 60), (3.167, 66), (3.5, 74)):
                h.append((B + x, "hat", v, {"tone": hat_tone, "decay": 24, "pan": -0.1}))
            if last or rng.random() < 0.3:
                h += [(B + 3.75, "hat", 60, {"tone": hat_tone}), (B + 3.875, "hat", 66, {"tone": hat_tone})]
            h.append((B + 1, "rim", 55, {}))
        elif style in ("boombap", "soul", "lofi"):
            swing = 0.08 if style != "lofi" else 0.1
            ks = [[0, 1.75, 2.5], [0, 0.75, 2.5], [0, 2.25, 2.75]][int(rng.integers(3))]
            for x in ks:
                h.append((B + x, "kick", 112, {"type": "boom"}))
            h.append((B + 1, "snare", 110, {"type": "boom"}))
            h.append((B + 3, "snare", 112, {"type": "boom"}))
            for i in range(8):
                x = i * 0.5 + (swing if i % 2 else 0)
                h.append((B + x, "hat", 78 if i % 2 == 0 else 58, {"decay": 34, "tone": 0.9}))
            if style != "lofi":
                h.append((B + 3.5 + swing, "tamb", 50, {"n": bar}))
            else:
                h += [(B + x + 0.25, "shaker", 45, {}) for x in range(4)]
        elif style == "rnb":
            ks = [[0, 1.5, 2.75], [0, 2.5]][int(rng.integers(2))]
            for x in ks:
                h.append((B + x, "kick", 105, {"type": "boom"}))
            h.append((B + 1, "clap", 95, {"tail": 0.25}))
            h.append((B + 3, "clap", 98, {"tail": 0.25}))
            h.append((B + 1, "snare", 60, {"type": "rim"}))
            for i in range(16):
                x = i * 0.25 + (0.04 if i % 2 else 0)
                h.append((B + x, "hat", 62 if i % 4 == 0 else 44, {"decay": 22, "tone": 1.05}))
            if bar % 2 == 1:
                h.append((B + 3.5, "ohat", 60, {}))
        elif style == "jersey":
            for x in (0, 0.75, 1.5, 2, 2.5, 3.25 if bar % 2 else 3):
                h.append((B + x, "kick", 115, {"type": "punch"}))
            for x in (1, 3):
                h.append((B + x, "clap", 105, {}))
            for i in range(8):
                h.append((B + i * 0.5, "hat", 70, {}))
        elif style == "afro":
            for x in (0, 1.5, 2, 3.5) if bar % 2 == 0 else (0, 1.5, 2.5, 3):
                h.append((B + x, "kick", 100, {"type": "boom"}))
            for x in (0.75, 2.25, 3.0) if bar % 2 == 0 else (1.0, 2.25, 3.25):
                h.append((B + x, "rim", 80, {}))
            h.append((B + 3, "clap", 90, {}))
            for i in range(16):
                h.append((B + i * 0.25, "shaker", 55 if i % 2 else 70, {}))
    return h
