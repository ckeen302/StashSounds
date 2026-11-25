"""Renders a loop spec (made by compose.py) to a seamless stereo loop.

A spec is plain data: tempo, bars, and tracks of notes or drum hits, each with its own effect chain,
then a mix bus. The pattern is played twice and the second pass is kept, so reverb and delay tails
from the end of the loop are already sounding at its start: the loop is seamless by construction.
"""
import numpy as np

import dsp
import instruments as I
from dsp import SR


def _fx(x, chain, bpm):
    beat = 60 / bpm
    for fx in chain:
        name, *a = fx
        if name == "lp":
            x = dsp.lp(x, *a)
        elif name == "hp":
            x = dsp.hp(x, *a)
        elif name == "eq":
            x = dsp.eq(x, *a)
        elif name == "reverb":
            mix, decay = a[0], a[1] if len(a) > 1 else 2.2
            x = dsp.reverb(x, mix=mix, decay=decay, predelay=a[2] if len(a) > 2 else 0.015, bright=a[3] if len(a) > 3 else 6500)
        elif name == "delay":
            beats, fb, mix = a[0], a[1], a[2]
            x = dsp.delay(x, beats * beat, feedback=fb, mix=mix, tone=a[3] if len(a) > 3 else 4500)
        elif name == "chorus":
            x = dsp.chorus(x, *a)
        elif name == "sat":
            x = dsp.saturate(x, *a)
        elif name == "crush":
            x = dsp.bitcrush(x, *a)
        elif name == "wobble":
            x = dsp.wobble(x, *a)
        elif name == "width":
            x = dsp.width(x, *a)
        elif name == "comp":
            x = dsp.compress(x, *a)
        elif name == "haas":
            x = dsp.haas(x, *a)
        elif name == "gain":
            x = x * 10 ** (a[0] / 20)
        elif name == "lofi":
            # A worn sampler: band-limited, a little crushed, wobbly.
            x = dsp.wobble(dsp.lp(dsp.hp(dsp.bitcrush(x, 12, 2), 90), 5200), 1.0, 0.5, 0.12)
        elif name == "telephone":
            x = dsp.bp(x, 350, 3200)
        else:
            raise ValueError(name)
    return x


def _voice(track, p, dur, vel, idx, glide_from=None):
    kind = track["kind"]
    if kind == "sampled":
        return I.sampler(track["inst"]).note(p, dur, vel, rr=1 + idx % 2, release=track.get("release"))
    if kind == "synth":
        return I.synth(track["inst"], p, dur, vel, seed=idx, glide_from=glide_from)
    raise ValueError(kind)


def _drum(name, vel, args, idx):
    if name == "kick":
        return I.kick(args.get("type", "trap"), vel, idx)
    if name == "snare":
        return I.snare(args.get("type", "trap"), vel, idx)
    if name == "clap":
        return I.clap(vel, idx, args.get("tail", 0.18))
    if name == "hat":
        return I.hat(vel, args.get("decay", 28), args.get("tone", 1.0), args.get("pan", 0.0))
    if name == "ohat":
        return I.openhat(vel, args.get("decay", 230), args.get("tone", 1.0))
    if name == "rim":
        return I.snare("rim", vel, idx)
    if name == "shaker":
        return I.shaker(vel, idx)
    if name in ("tamb", "shake", "clapreal", "cowbellreal"):
        return I.perc(name, vel, args.get("n", idx))
    raise ValueError(name)


def render_track(track, bpm, beats, total):
    beat = 60 / bpm
    out = np.zeros((total, 2))
    g = dsp.rng(hash(track.get("name", track.get("inst", "x"))) & 0xFFFF)
    hum = track.get("humanize", 0.006)
    if track["kind"] == "808":
        notes = []
        for cyc in range(2):
            for (s, d, p, v, glide) in track["notes"]:
                notes.append(((s + cyc * beats) * beat, d * beat, p, v, glide))
        notes.sort()
        out = I.eight08(notes, total, drive=track.get("drive", 1.8), decay=track.get("decay"))
    elif track["kind"] == "drums":
        hits = []
        jit = g.normal(0, hum, max(1, len(track["hits"])))
        for cyc in range(2):
            for h in track["hits"]:
                hits.append((h[0] + cyc * beats, *h[1:]))
        for i, h in enumerate(hits):
            b, name, vel = h[0], h[1], h[2]
            args = h[3] if len(h) > 3 else {}
            x = _drum(name, vel, args, i % len(track["hits"]))
            # The same push or drag on both passes, and never early on the downbeat (it would fall
            # off the front of the loop).
            j = jit[i % len(track["hits"])] * 0.4 if name != "kick" else 0.0
            if h[0] % beats == 0:
                j = abs(j)
            at = int((b * beat + j) * SR)
            dsp.add(out, x, max(0, at))
    else:
        prev = None
        notes = track["notes"]
        jit = g.normal(0, hum, max(1, len(notes))) if hum else np.zeros(max(1, len(notes)))
        vj = g.normal(0, track.get("velJitter", 5), max(1, len(notes)))
        for cyc in range(2):
            for i, n in enumerate(notes):
                s, d, p, v = n[:4]
                glide = n[4] if len(n) > 4 else False
                at = (s + cyc * beats) * beat
                # The same timing and velocity on both passes, so the kept pass loops exactly.
                jitter = abs(jit[i]) if s % beats == 0 else jit[i]
                vel = int(np.clip(v + vj[i], 20, 127))
                x = _voice(track, p, d * beat, vel, i, glide_from=prev if glide else None)
                prev = p
                dsp.add(out, x, max(0, int((at + jitter) * SR)))
    out = _fx(out, track.get("fx", []), bpm)
    out = dsp.stereo(out, track.get("pan", 0.0)) if track.get("pan") else out
    return out


# Mixing by numbers: each part is set to a loudness for its role (K-weighted RMS over the loop, dBFS),
# so the balance holds whatever the instrument's raw level is. A track's "gain" trims from there.
ROLE_LEVEL = {"lead": -19, "chords": -21, "keys": -21, "pad": -25, "counter": -24, "arp": -23, "bass": -22, "808": -20,
              "kick": -21.5, "snare": -22.5, "hats": -26.5, "perc": -29.5, "texture": -34}
DRUM_GROUP = {"kick": "kick", "snare": "snare", "clap": "snare", "rim": "perc", "hat": "hats", "ohat": "hats", "shaker": "perc",
              "tamb": "perc", "shake": "perc", "clapreal": "snare", "cowbellreal": "perc"}


def kloud(x):
    m = dsp.hp(x, 60)
    m = dsp.eq(m, "highshelf", 1500, 4)
    return 10 * np.log10(np.mean(m**2) + 1e-12)


def _level(x, role, trim=0.0):
    target = ROLE_LEVEL[role] + trim
    return x * 10 ** ((target - kloud(x)) / 20)


def render(spec):
    bpm, bars = spec["bpm"], spec["bars"]
    beats = bars * 4
    loop_len = int(round(beats * 60 / bpm * SR))
    dsp.PERIOD = loop_len
    total = loop_len * 2
    mix = np.zeros((total, 2))
    kicks = []
    stems = {}
    tracks = []
    for t in spec["tracks"]:
        if t["kind"] == "drums":
            groups = {}
            for h in t["hits"]:
                groups.setdefault(DRUM_GROUP[h[1]], []).append(h)
            for gname, hits in groups.items():
                tracks.append({**t, "hits": hits, "name": f"{t.get('name', 'drums')}-{gname}", "role": gname,
                               "fx": t.get("fx", []) + t.get("fx_" + gname, []), "gain": t.get("gain", 0) + t.get("gain_" + gname, 0)})
        else:
            tracks.append(t)
    for t in tracks:
        x = render_track(t, bpm, beats, total)
        role = t.get("role") or ("808" if t["kind"] == "808" else "chords")
        seg = x[loop_len:]
        x = x * 10 ** ((ROLE_LEVEL[role] + t.get("gain", 0) - kloud(seg)) / 20) if np.any(seg) else x
        if t.get("duck"):
            kick_beats = sorted({h[0] + c * beats for c in range(2) for tr in spec["tracks"] if tr["kind"] == "drums" for h in tr["hits"] if h[1] == "kick"})
            x = dsp.duck(x, [b * 60 / bpm for b in kick_beats], depth=t["duck"], release=0.16)
        stems[t.get("name", t.get("inst"))] = x
        mix += x
    if spec.get("vinyl"):
        v = np.tile(dsp.vinyl(loop_len, spec["vinyl"]), (2, 1))
        mix += v * 10 ** ((ROLE_LEVEL["texture"] - kloud(v[loop_len:])) / 20)
    mix = _fx(mix, spec.get("bus", [("comp", -16, 2.0, 0.01, 0.15)]), bpm)
    out = mix[loop_len : loop_len * 2]
    out = dsp.hp(out, 25)
    out = dsp.limit(out, 0.92, spec.get("drive", 1.0))
    return out, loop_len
