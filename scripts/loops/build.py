#!/usr/bin/env python3
"""Builds the demo's loop library: plans the loops (catalog.py), renders each one (render.py), checks
its key against the audio, encodes the preview the way the worker does, and writes the catalog.

Output:
  apps/web/src/demo/loop-library/media/<slug>.mp3   committed previews (like the SFX and creator loops)
  apps/web/src/demo/loop-library/loops.json         the catalog entries, in more-loops.json's shape

Usage: python3 scripts/loops/build.py [--only slug,slug] [--jobs 4] [--wav DIR]
Needs numpy, scipy, soundfile, ffmpeg, and the CC0 instruments (scripts/loops/fetch-instruments.sh).
"""
import argparse
import base64
import hashlib
import json
import subprocess
import sys
import wave
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import catalog as K  # noqa: E402
import compose as C  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SR = 44100
LIMITS = json.loads((ROOT / "packages/contracts/limits.json").read_text())
LIB = ROOT / "apps/web/src/demo/loop-library"
MEDIA = LIB / "media"
NOTE = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

# How many loops each family gets, and how many of those are full beats (melody, 808 and drums).
PLAN = {"trap": (30, 8), "drill": (18, 5), "plugg": (20, 5), "rage": (16, 5), "phonk": (8, 3), "rnb": (18, 3), "soul": (10, 1), "lofi": (8, 2), "boombap": (8, 2)}

# Drum-only loops: (style, bpm, bars, title)
DRUM_LOOPS = [
    ("trap", 140, 4, "Ice Tray Drums"), ("trap", 150, 4, "Side Door Drums"), ("trap", 135, 4, "Paper Plate Drums"),
    ("drill", 142, 4, "Block Watch Drums"), ("drill", 144, 4, "Night Bus Drums"), ("plugg", 150, 4, "Sticker Book Drums"),
    ("plugg", 155, 4, "Arcade Glow Drums"), ("rage", 160, 4, "Mosh Pit Drums"), ("rage", 165, 4, "Red Light Drums"),
    ("phonk", 130, 4, "Drift Mode Drums"), ("boombap", 90, 4, "Crate Dust Drums"), ("boombap", 94, 4, "Basement Tape Drums"),
    ("rnb", 80, 4, "Slow Burn Drums"), ("rnb", 68, 4, "Candle Wax Drums"), ("lofi", 78, 4, "Rain Check Drums"), ("jersey", 140, 4, "Bed Squeak Drums"),
]
DRUM_GENRE = {"trap": "Trap", "drill": "Drill", "plugg": "Plugg", "rage": "Rage", "phonk": "Phonk", "boombap": "Boom bap", "rnb": "R&B", "lofi": "Lo-fi", "jersey": "Jersey club"}
DRUM_REF = {"trap": "metro boomin", "drill": "ax", "plugg": "pi'erre bourne", "rage": "f1lthy", "phonk": "dj smokey", "boombap": "alchemist", "rnb": "brent faiyaz", "lofi": "nujabes", "jersey": "dj sliink"}


def plan():
    progs = [C.Prog(p) for p in C.load_progressions()]
    by_fam = {}
    for p in progs:
        f = K.family(p)
        if f and p.beats in (16, 32):
            by_fam.setdefault(f, []).append(p)
    specs = []
    seen = set()
    for fam, (count, full) in PLAN.items():
        pool = by_fam.get(fam, [])
        g = np.random.default_rng(abs(hash(fam)) % 9973 if False else sum(map(ord, fam)))
        order = g.permutation(len(pool))
        recipes = K.RECIPES[fam]
        picked = 0
        for i in order:
            if picked >= count:
                break
            p = pool[i]
            slug = K.slugify(p.title)
            if slug in seen or not key_clear(p):
                continue
            seen.add(slug)
            specs.append({"fam": fam, "title": p.title, "recipe": recipes[picked % len(recipes)].__name__, "full": picked < full, "seed": 1000 + picked})
            picked += 1
    for i, (style, bpm, bars, title) in enumerate(DRUM_LOOPS):
        specs.append({"fam": style, "title": title, "drums": True, "bpm": bpm, "bars": bars, "seed": 5000 + i})
    return specs


def key_clear(p):
    """Keeps progressions whose tagged key is plain from the chords: the best key fit, or starting on its tonic."""
    ch = np.zeros(12)
    for (_, beats, _, notes) in p.chords:
        for k, n in enumerate(notes):
            ch[n % 12] += beats * (2 if k == 0 else 1)
    ok, _, _ = key_ok((p.root, p.mode), best_key(ch))
    return ok or p.chords[0][3][0] % 12 == p.root


def key_name(root, mode):
    return f"{NOTE[root]} {mode}"


def build_spec(item):
    g = np.random.default_rng(item["seed"])
    if item.get("drums"):
        style = item["fam"]
        hits = C.drums(style, item["bars"], g)
        spec = {"bpm": item["bpm"], "bars": item["bars"], "tracks": [{"name": "drums", "kind": "drums", "hits": hits}], "key": None}
        if style in ("lofi", "boombap"):
            spec["tracks"][0]["fx"] = [("lofi",)]
            spec["vinyl"] = 0.6
        copy = {
            "title": item["title"], "tags": [{"boombap": "boom bap", "jersey": "jersey club"}.get(style, style), "drums", "drum loop"],
            "genre": DRUM_GENRE[style], "reference": DRUM_REF[style],
            "description": {
                "trap": "Half-time trap drums: clap and snare on three, hats with triplet and 32nd rolls into each bar. No 808, so your own sits on top.",
                "drill": "Drill drums: skippy triplet hats, the snare on three with a late second hit, sparse punchy kicks.",
                "plugg": "Soft plugg drums: a round clap on three, simple eighth hats with a roll at the end of the bar.",
                "rage": "Hard rage drums: distorted kicks, sixteenth hats and rolls, the clap stacked with a snare.",
                "phonk": "Phonk drums with a cowbell on the offbeats, made for a distorted 808.",
                "boombap": "Swung boom bap drums through a worn sampler, snare on two and four, a tambourine on the last eighth.",
                "rnb": "Slow R&B drums: soft claps on two and four with a rim, loose sixteenth hats.",
                "lofi": "Lo-fi drums: lazy swing, dusty kick and snare, shaker and vinyl.",
                "jersey": "Jersey club drums: the bouncing kick pattern under claps on two and four.",
            }[style],
        }
        return spec, copy
    progs = {p["title"]: p for p in C.load_progressions()}
    p = C.Prog(progs[item["title"]])
    recipe = getattr(K, item["recipe"])
    tracks, insts, sentence = recipe(p, g)
    fam = item["fam"]
    spec = {"bpm": p.bpm, "bars": p.bars, "tracks": tracks, "key": (p.root, p.mode)}
    if item["recipe"] in ("r_lofi", "r_boombap"):
        spec["vinyl"] = 0.5
    tags = [{"boombap": "boom bap"}.get(fam, fam)]
    for i in insts:
        t = K.TAGS.get(i)
        if t and t not in tags:
            tags.append(t)
    for t in p.p["tags"][1:]:
        if t not in tags and len(tags) < 5:
            tags.append(t)
    if item["full"]:
        st = K.DRUM_STYLE[fam]
        spec["tracks"] = [dict(t, duck=0.35) if t["role"] in ("pad", "chords") else t for t in tracks]
        spec["tracks"].append({"name": "drums", "kind": "drums", "hits": C.drums(st, p.bars, g)})
        if fam in K.B808_STYLE:
            spec["tracks"].append({"name": "808", "kind": "808", "notes": C.bass808(p, K.B808_STYLE[fam], g), "role": "808", "drive": 2.4 if fam in ("rage", "phonk") else 1.8})
        tags = tags[:3] + ["drums", "808" if fam in K.B808_STYLE else "full beat"]
    chords = " - ".join(p.symbols()[:6])
    full_note = " Full beat with drums" + (" and 808" if fam in K.B808_STYLE else "") + "; the melody-only parts stay up front." if item["full"] else " No drums, so it sits under any bounce."
    copy = {
        "title": p.title + (" (full beat)" if item["full"] else ""),
        "tags": tags[:5],
        "genre": K.GENRE[fam],
        "reference": K.REFERENCE[item["recipe"]],
        "description": f"{sentence} Chords: {chords}.{full_note}",
    }
    return spec, copy


def render_one(item):
    import render as R

    spec, copy = build_spec(item)
    out, loop_len = R.render(spec)
    return item, spec, copy, out, loop_len


def write_wav(path, st):
    data = (np.clip(st, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def ffmpeg(args):
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
    r = ffmpeg(["-i", str(mp3), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"])
    s = np.abs(np.frombuffer(r.stdout, dtype="<f4"))
    n = len(s)
    out = bytes(min(255, round(float(np.max(s[(i * n) // points : max((i * n) // points + 1, ((i + 1) * n) // points)])) * 255)) for i in range(points))
    return base64.b64encode(out).decode()


# Krumhansl-Kessler key profiles, for checking each loop's tagged key against its audio.
KK_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def note_chroma(spec):
    """Pitch-class weight of the written notes (duration x velocity), bass weighted up."""
    ch = np.zeros(12)
    for t in spec["tracks"]:
        if t["kind"] in ("sampled", "synth", "808"):
            for n in t["notes"]:
                ch[n[2] % 12] += n[1] * n[3] / 127 * (1.5 if n[2] < 52 else 1.0)
    return ch


def audio_chroma(x):
    m = x.mean(axis=1)
    n = 16384
    ch = np.zeros(12)
    for i in range(0, len(m) - n, n // 2):
        S = np.abs(np.fft.rfft(m[i : i + n] * np.hanning(n)))
        f = np.fft.rfftfreq(n, 1 / SR)
        band = (f > 50) & (f < 2000)
        midi = 69 + 12 * np.log2(f[band] / 440)
        pc = np.round(midi).astype(int) % 12
        np.add.at(ch, pc, S[band] ** 2)
    return ch


def best_key(ch):
    scores = []
    for r in range(12):
        scores.append((np.corrcoef(np.roll(KK_MAJ, r), ch)[0, 1], r, "major"))
        scores.append((np.corrcoef(np.roll(KK_MIN, r), ch)[0, 1], r, "minor"))
    scores.sort(reverse=True)
    return scores


def key_ok(tag, scores):
    """The tagged key must be the best fit, or within 0.03 of it (relative keys share their notes)."""
    best = scores[0][0]
    for s, r, m in scores:
        if (r, m) == tag:
            return best - s <= 0.03, s, best
    return False, 0, best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--wav", default="")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    items = plan()
    if a.list:
        for it in items:
            print(it)
        print(len(items), "loops")
        return
    if a.only:
        want = set(a.only.split(","))
        items = [it for it in items if K.slugify(build_spec_title(it)) in want]
    MEDIA.mkdir(parents=True, exist_ok=True)
    work = Path(a.wav or "/tmp/stash-loop-library")
    work.mkdir(parents=True, exist_ok=True)
    existing = {}
    cat = LIB / "loops.json"
    if cat.exists() and a.only:
        existing = {l["slug"]: l for l in json.loads(cat.read_text())["loops"]}
    pv = LIMITS["preview"]
    results = {}
    problems = []
    with ProcessPoolExecutor(a.jobs) as ex:
        for item, spec, copy, out, loop_len in ex.map(render_one, items):
            slug = K.slugify(copy["title"])
            wav = work / f"{slug}.wav"
            write_wav(wav, out)
            duration_ms = round(loop_len / SR * 1000)
            kbps = pv["loopBitrateKbpsShort"] if duration_ms <= pv["loopShortMaxMs"] else pv["loopBitrateKbpsLong"]
            mp3 = MEDIA / f"{slug}.mp3"
            ffmpeg(["-i", str(wav), "-af", f"{loudnorm(wav)},aresample={SR}", "-ar", str(SR), "-ac", "2", "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-f", "mp3", "-y", str(mp3)])
            size = mp3.stat().st_size
            if size > pv["loopMaxBytes"]:
                raise RuntimeError(f"{slug}: {size} B over limits.preview.loopMaxBytes")
            key = None
            note = ""
            if spec["key"]:
                root, mode = spec["key"]
                key = {"root": root, "mode": mode}
                ok_n, sn, bn = key_ok((root, mode), best_key(note_chroma(spec)))
                ok_a, sa, ba = key_ok((root, mode), best_key(audio_chroma(out)))
                note = f"key {key_name(root, mode)}: notes {sn:.2f}/{bn:.2f}, audio {sa:.2f}/{ba:.2f}"
                if not ok_n:
                    s = best_key(note_chroma(spec))[0]
                    problems.append(f"{slug}: tagged {key_name(root, mode)}, notes fit {key_name(s[1], s[2])} better ({bn:.2f} vs {sn:.2f})")
            # Seam: the jump between the last and first sample, against the loop's typical step.
            step = np.abs(np.diff(out[:, 0]))
            seam = abs(out[0, 0] - out[-1, 0]) / (np.percentile(step, 99.9) + 1e-9)
            if seam > 1.5:
                problems.append(f"{slug}: seam jump {seam:.2f}x the 99.9th percentile step")
            results[slug] = {
                "slug": slug, "bpm": spec["bpm"], "bars": spec["bars"], "key": key, "loopSamples": loop_len, "sampleRate": SR, "durationMs": duration_ms,
                "preview": {"path": f"demo/media/{slug}.mp3", "bytes": size, "sha256": hashlib.sha256(mp3.read_bytes()).hexdigest(), "kbps": kbps},
                "peaks": peaks(mp3, LIMITS["waveform"]["peakPoints"]),
                "copy": {**copy, "recipe": item.get("recipe", "drums")},
            }
            print(f"{slug}: {spec['bpm']} BPM, {spec['bars']} bars, {size // 1024} KB, {note}", flush=True)
    merged = {**existing, **results}
    order = [K.slugify(build_spec_title(it)) for it in plan()]
    loops = [merged[s] for s in order if s in merged]
    cat.write_text(json.dumps({"$comment": "Generated by scripts/loops/build.py. Do not edit.", "loops": loops}, indent=1) + "\n")
    print(f"wrote {len(loops)} loops")
    if problems:
        print("\nCHECKS:\n" + "\n".join(problems))


def build_spec_title(it):
    if it.get("drums"):
        return it["title"]
    return it["title"] + (" (full beat)" if it["full"] else "")


if __name__ == "__main__":
    main()
