#!/usr/bin/env python3
"""The demo's SFX library (the SFX tab). Lead-owned, like scripts/build-demo.mjs.

Two kinds of sound go in:
  - originals synthesized here from scripts/sfx/recipes.py (oscillators, noise, filters; nothing sampled)
  - public-domain and CC0 recordings listed in scripts/sfx/recordings.json, each with its source page,
    author and license, fetched from Wikimedia Commons into .local/sfx-cache/ (gitignored)

Out:
  apps/web/src/demo/sfx/media/<category>-<subcategory>.mp3   one sprite per subcategory (an Artifact
                                                             publish takes a few hundred files at most)
  apps/web/src/demo/sfx/library.json                         every sound: place in the tree, tags,
                                                             sprite offset, length, peaks, source, license

Usage: python3 scripts/build-demo-sfx.py [--only <text>] [--jobs N]
Needs numpy, scipy and ffmpeg. Deterministic: each synthesized sound seeds its noise from its name.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
import wave
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts/sfx"))

from dsp import SR, finish, hp, lp  # noqa: E402

OUT_MEDIA = ROOT / "apps/web/src/demo/sfx/media"
OUT_JSON = ROOT / "apps/web/src/demo/sfx/library.json"
CACHE = ROOT / ".local/sfx-cache"
UA = {"User-Agent": "StashDemoSfx/0.1 (https://github.com/ckeen302/stashsounds)"}
GAP = 0.6  # silence between sounds in a sprite, so mp3 padding never clips a neighbour
PEAKS = 72
MAX_LEN = 20.0

CATEGORIES = [
    ("animals", "Animals", [("big-cats", "Big cats"), ("dogs-wolves", "Dogs and wolves"), ("pets", "Cats"), ("birds", "Birds"), ("farm", "Farm"), ("wild", "Wild animals"), ("insects", "Insects and frogs")]),
    ("vehicles", "Vehicles", [("supercars", "Supercars"), ("cars", "Cars"), ("horns", "Horns"), ("trains", "Trains"), ("aircraft", "Aircraft"), ("motorcycles", "Motorcycles"), ("boats", "Boats")]),
    ("sirens", "Sirens and alarms", [("police", "Police"), ("ambulance-fire", "Ambulance and fire"), ("air-raid", "Air raid and warning"), ("alarm-clocks", "Alarm clocks and bells"), ("buzzers", "Buzzers and beeps"), ("car-alarms", "Car alarms")]),
    ("phones", "Phones and voicemail", [("voicemail", "Voicemail"), ("rings", "Rings and ringtones"), ("line-tones", "Dial and line tones"), ("dialing", "Dialing"), ("notifications", "Notifications"), ("radio", "Radio and walkie")]),
    ("human", "Human", [("yells", "Yells and screams"), ("gibberish", "Gibberish"), ("crowd", "Crowds"), ("reactions", "Laughs and reactions"), ("body", "Body")]),
    ("weapons", "Weapons", [("gunshots", "Gunshots"), ("reloads", "Reloads and cocks"), ("explosions", "Explosions")]),
    ("impacts", "Impacts", [("booms", "Booms"), ("hits", "Hits and punches"), ("braams", "Braams"), ("sub-drops", "Sub drops")]),
    ("transitions", "Transitions", [("risers", "Risers"), ("downlifters", "Downlifters"), ("whooshes", "Whooshes"), ("reverse", "Reverse"), ("tape-stops", "Tape stops and scratches"), ("glitches", "Glitches")]),
    ("money", "Money", [("register", "Cash register"), ("counting", "Money counters"), ("coins", "Coins")]),
    ("ambience", "Ambience", [("weather", "Rain, thunder and wind"), ("nature", "Nature"), ("city", "City and texture")]),
    ("scifi", "Sci-fi and games", [("lasers", "Lasers"), ("game", "8-bit game"), ("space", "Space and computers")]),
    ("foley", "Foley", [("doors", "Doors and knocks"), ("household", "Household"), ("footsteps", "Footsteps")]),
]


def slug(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-").replace("--", "-")


# ---------------------------------------------------------------------------------------------
# Synthesized


def render_synth(i: int) -> tuple[int, np.ndarray]:
    from recipes import SOUNDS

    cat, sub, name, fn, params, tags = SOUNDS[i]
    rng = np.random.default_rng(zlib.crc32(name.encode()))
    x = finish(np.asarray(fn(rng, **params), dtype=float))
    return i, x[: int(MAX_LEN * SR)].astype(np.float32)


# ---------------------------------------------------------------------------------------------
# Recordings


def fetch(title: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    name = title.removeprefix("File:")
    dest = CACHE / (hashlib.sha1(name.encode()).hexdigest()[:16] + Path(name).suffix.lower())
    if not dest.exists():
        under = name.replace(" ", "_")
        h = hashlib.md5(under.encode()).hexdigest()
        url = f"https://upload.wikimedia.org/wikipedia/commons/{h[0]}/{h[:2]}/{urllib.parse.quote(under)}"
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
            dest.write_bytes(r.read())
    return dest


def decode(path: Path, start: float, end: float | None) -> np.ndarray:
    args = ["ffmpeg", "-v", "error", "-ss", str(start)]
    if end is not None:
        args += ["-t", str(max(0.05, end - start))]
    args += ["-i", str(path), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(args, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(float)


def loudest(x: np.ndarray, sec: float) -> np.ndarray:
    """The `sec`-long stretch with the most energy: the roar, not the minute of zoo around it."""
    win = int(sec * SR)
    if len(x) <= win:
        return x
    hop = int(0.05 * SR)
    e = np.array([np.mean(x[i : i + hop] ** 2) for i in range(0, len(x) - hop, hop)])
    k = max(1, win // hop)
    sums = np.convolve(e, np.ones(k), "valid")
    best = int(np.argmax(sums)) * hop
    # Start a touch early so the attack is whole.
    best = max(0, best - int(0.15 * SR))
    return x[best : best + win]


def render_recording(r: dict) -> np.ndarray:
    x = decode(fetch(r["file"]), r.get("start", 0.0), r.get("end"))
    if "end" not in r:
        x = loudest(x, r.get("length", 10.0))
    if r.get("highpass"):
        x = hp(x, r["highpass"])
    if r.get("lowpass"):
        x = lp(x, r["lowpass"])
    x = finish(x, fout=r.get("fadeOut", 0.25), fin=r.get("fadeIn", 0.01))
    return x[: int(MAX_LEN * SR)].astype(np.float32)


# ---------------------------------------------------------------------------------------------
# Output


def peaks_of(x: np.ndarray) -> list[float]:
    # Loudness per bar (RMS, on a dB-ish curve), so a loud sustained sound still shows its shape.
    m = np.mean(x**2, axis=1)
    edges = np.linspace(0, len(m), PEAKS + 1).astype(int)
    p = np.array([np.sqrt(m[a:b].mean()) if b > a else 0 for a, b in zip(edges[:-1], edges[1:])])
    p = p / (p.max() + 1e-9)
    p = np.clip(1 + 20 * np.log10(np.maximum(p, 1e-4)) / 42, 0, 1)
    return [round(float(v), 3) for v in p]


def write_sprite(path: Path, clips: list[np.ndarray]) -> list[tuple[float, float]]:
    parts, spans, pos = [], [], 0
    lead = np.zeros((int(0.1 * SR), 2), dtype=np.float32)
    parts.append(lead)
    pos += len(lead)
    for c in clips:
        spans.append((pos / SR, len(c) / SR))
        parts.append(c)
        g = np.zeros((int(GAP * SR), 2), dtype=np.float32)
        parts.append(g)
        pos += len(c) + len(g)
    audio = np.concatenate(parts)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    tmp = path.with_suffix(".tmp.wav")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-codec:a", "libmp3lame", "-b:a", "96k", "-map_metadata", "-1", str(path)], check=True)
    tmp.unlink()
    return spans


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()

    from recipes import SOUNDS

    entries: list[dict] = []
    clips: dict[int, np.ndarray] = {}
    with ProcessPoolExecutor(args.jobs) as ex:
        for i, x in ex.map(render_synth, range(len(SOUNDS))):
            clips[i] = x
            print(f"  synth {i + 1}/{len(SOUNDS)} {SOUNDS[i][2]}", flush=True)
    for i, (cat, sub, name, fn, params, tags) in enumerate(SOUNDS):
        entries.append({"cat": cat, "sub": sub, "name": name, "tags": tags, "audio": clips[i], "source": {"kind": "original", "license": "CC0-1.0", "by": "Stash (synthesized)"}})

    recs = json.loads((ROOT / "scripts/sfx/recordings.json").read_text())["recordings"]
    for r in recs:
        try:
            x = render_recording(r)
        except Exception as e:  # a missing file is reported, never silently replaced
            print(f"  ! {r['name']}: {e}", file=sys.stderr)
            continue
        print(f"  recording {r['name']}", flush=True)
        entries.append({
            "cat": r["cat"], "sub": r["sub"], "name": r["name"], "tags": r.get("tags", []), "audio": x,
            "source": {"kind": "recording", "license": r["license"], "by": r["author"], "page": r["page"], "title": r["file"].removeprefix("File:")},
        })

    known = {(c, s) for c, _, subs in CATEGORIES for s, _ in subs}
    for e in entries:
        if (e["cat"], e["sub"]) not in known:
            raise SystemExit(f"{e['name']}: unknown place {e['cat']}/{e['sub']}")

    OUT_MEDIA.mkdir(parents=True, exist_ok=True)
    for old in OUT_MEDIA.glob("*.mp3"):
        old.unlink()
    sounds = []
    used_ids: set[str] = set()
    for cat, _, subs in CATEGORIES:
        for sub, _ in subs:
            group = [e for e in entries if e["cat"] == cat and e["sub"] == sub]
            # Recordings first: a real lion before a synthesized one.
            group.sort(key=lambda e: e["source"]["kind"] != "recording")
            if not group:
                continue
            file = f"{cat}-{sub}.mp3"
            spans = write_sprite(OUT_MEDIA / file, [e["audio"] for e in group])
            for e, (start, dur) in zip(group, spans):
                sid = slug(e["name"])[:48]
                while sid in used_ids:
                    sid += "-2"
                used_ids.add(sid)
                sounds.append({
                    "id": sid, "name": e["name"], "cat": cat, "sub": sub, "tags": e["tags"],
                    "file": file, "start": round(start, 4), "duration": round(dur, 4),
                    "stereo": bool(np.max(np.abs(e["audio"][:, 0] - e["audio"][:, 1])) > 1e-3),
                    "peaks": peaks_of(e["audio"]), "source": e["source"],
                })
            print(f"{file}: {len(group)} sounds, {(OUT_MEDIA / file).stat().st_size // 1024} KB")
    lib = {
        "categories": [{"id": c, "name": n, "subs": [{"id": s, "name": sn} for s, sn in subs]} for c, n, subs in CATEGORIES],
        "sounds": sounds,
    }
    OUT_JSON.write_text(json.dumps(lib, separators=(",", ":")) + "\n")
    total = sum(p.stat().st_size for p in OUT_MEDIA.glob("*.mp3"))
    print(f"{len(sounds)} sounds ({sum(s['source']['kind'] == 'recording' for s in sounds)} recordings), {total / 1e6:.1f} MB of media")


if __name__ == "__main__":
    main()
