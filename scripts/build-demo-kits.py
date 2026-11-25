"""Builds the demo's "inspired by" drum kits: original hits synthesized in the style of well-known
producers' records. None of it is the producers' own samples.

Writes:
  apps/web/src/demo/kits/media/<kit>.mp3   one sprite per kit (a sound is a slice of it)
  apps/web/src/demo/kits/library.json      every kit: name, who it is inspired by, and each sound's span

Needs numpy, scipy and ffmpeg. Deterministic: each sound seeds its noise from its kit and name.
"""
from __future__ import annotations

import json
import subprocess
import sys
import wave
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/kits"))
sys.path.insert(0, str(ROOT / "scripts/sfx"))
import drums as d  # noqa: E402
from dsp import SR, finish  # noqa: E402

OUT_MEDIA = ROOT / "apps/web/src/demo/kits/media"
OUT_JSON = ROOT / "apps/web/src/demo/kits/library.json"
GAP = 0.5

H = d.hz

# Each kit: id, name, inspired_by, genre, description, published, sounds [(name, category, fn(rng))].
KITS = [
    {
        "id": "pinksky", "name": "Pink Sky kit", "by": "Pi'erre Bourne", "genre": "Plugg", "at": "2026-11-25T18:00:00Z",
        "about": "Bouncy short 808s, airy snares, bright crispy hats, laser zaps and little bells, the plugg-era sound Pierre Bourne made famous.",
        "sounds": [
            ("808 bounce F", "808", lambda r: d.sub808(r, H("F"), 0.9, 3, 1.4, tail=0.7)),
            ("808 bounce G", "808", lambda r: d.sub808(r, H("G"), 0.9, 3, 1.4, tail=0.7)),
            ("808 bounce A#", "808", lambda r: d.sub808(r, H("A#"), 0.8, 3, 1.4, tail=0.7)),
            ("808 glide D#", "808", lambda r: d.sub808(r, H("D#"), 1.4, 3, 1.5, slide_from=H("A#"), slide_time=0.09)),
            ("808 long C", "808", lambda r: d.sub808(r, H("C", 2), 1.8, 2.5, 1.3)),
            ("Kick soft", "kick", lambda r: d.kick(r, 140, 55, 0.03, 0.18, 1.4, 0.35, 0.45)),
            ("Kick knock", "kick", lambda r: d.kick(r, 190, 60, 0.02, 0.12, 2.2, 0.8, 0.35)),
            ("Snare air", "snare", lambda r: d.snare(r, 230, 0.4, 0.2, 2600, 0.8, 1.2, room=0.35)),
            ("Snare thin", "snare", lambda r: d.snare(r, 260, 0.3, 0.11, 3200, 0.4, 1.1)),
            ("Clap pop", "clap", lambda r: d.clap(r, 3, 0.009, 1600, 1.3, 0.12, 0.6, 0.2)),
            ("Snap", "clap", lambda r: d.snap(r, 2600)),
            ("Hat crisp", "hat", lambda r: d.hat(r, 0.025, 1.15, 10500)),
            ("Hat tick", "hat", lambda r: d.hat(r, 0.012, 1.3, 11500)),
            ("Hat soft", "hat", lambda r: d.hat(r, 0.05, 1.0, 8500, noise_mix=0.6)),
            ("Open hat", "open hat", lambda r: d.open_hat(r, 0.22, 1.15, 10000)),
            ("Laser zap", "perc", lambda r: d.zap(r, 4200, 300, 0.05)),
            ("Laser zap low", "perc", lambda r: d.zap(r, 2200, 120, 0.08)),
            ("Bell C", "perc", lambda r: d.bell(r, 1046.5, 0.45, 3.5, 1.2)),
            ("Bell G", "perc", lambda r: d.bell(r, 1568.0, 0.35, 3.5, 1.2)),
            ("Crash bright", "cymbal", lambda r: d.crash(r, 1.0, 1.15)),
            ("Riser", "fx", lambda r: d.riser(r, 1.8)),
        ],
    },
    {
        "id": "redroom", "name": "Red Room kit", "by": "F1lthy", "genre": "Rage", "at": "2026-11-25T17:30:00Z",
        "about": "Blown-out 808s, crushed kicks, crunchy snares, glitches and reversed cymbals for rage and Opium-style beats in the spirit of F1lthy.",
        "sounds": [
            ("808 blown C#", "808", lambda r: d.sub808(r, H("C#"), 1.6, 3.5, 4.5, crush=6)),
            ("808 blown F", "808", lambda r: d.sub808(r, H("F"), 1.4, 3.5, 5, crush=6)),
            ("808 fuzz G#", "808", lambda r: d.sub808(r, H("G#"), 1.2, 3, 6, crush=5, tail=0.4)),
            ("808 dive", "808", lambda r: d.sub808(r, H("D"), 1.8, 3, 4, slide_from=H("D", 2), slide_time=0.35, crush=7)),
            ("Kick crushed", "kick", lambda r: d.kick(r, 200, 50, 0.03, 0.25, 4, 0.9, 0.5, crush=5)),
            ("Kick clipped", "kick", lambda r: d.kick(r, 170, 45, 0.04, 0.3, 6, 0.6, 0.55)),
            ("Snare crunch", "snare", lambda r: d.snare(r, 200, 0.7, 0.14, 1500, 0.45, 3.5, crush=5)),
            ("Snare static", "snare", lambda r: d.snare(r, 240, 0.4, 0.22, 2000, 0.6, 2.5, crush=4, room=0.2)),
            ("Clap distorted", "clap", lambda r: d.clap(r, 4, 0.012, 1100, 0.9, 0.2, 0.7, 0.15, 4, crush=5)),
            ("Clap wide", "clap", lambda r: d.clap(r, 5, 0.014, 1400, 1.0, 0.25, 0.9, 0.4, 2)),
            ("Hat bitcrushed", "hat", lambda r: d.hat(r, 0.03, 1.0, 9000, crush=5)),
            ("Hat glass", "hat", lambda r: d.hat(r, 0.02, 1.4, 12000)),
            ("Open hat dirty", "open hat", lambda r: d.open_hat(r, 0.3, 0.9, 8000)),
            ("Metal perc", "perc", lambda r: d.bell(r, 620, 0.25, 1.41, 4, 0.9, 0.1)),
            ("Glitch", "fx", lambda r: d.glitch(r, 0.5, 0.025)),
            ("Glitch fast", "fx", lambda r: d.glitch(r, 0.35, 0.012)),
            ("Reverse crash", "fx", lambda r: d.reverse(d.crash(r, 1.0, 1.0, 1.8))),
            ("Impact", "fx", lambda r: d.impact(r, 2.0)),
        ],
    },
    {
        "id": "midnightscore", "name": "Midnight Score kit", "by": "Metro Boomin", "genre": "Trap", "at": "2026-11-25T17:00:00Z",
        "about": "Deep long 808s, a hard clap and snare, crisp hats for rolls, dark crashes and cinematic stabs for the dark, orchestral trap Metro Boomin is known for.",
        "sounds": [
            ("808 long C", "808", lambda r: d.sub808(r, H("C"), 2.4, 2.5, 1.8)),
            ("808 long D#", "808", lambda r: d.sub808(r, H("D#"), 2.4, 2.5, 1.8)),
            ("808 long F", "808", lambda r: d.sub808(r, H("F"), 2.2, 2.5, 1.9)),
            ("808 long G", "808", lambda r: d.sub808(r, H("G"), 2.2, 2.5, 1.9)),
            ("808 slide A#", "808", lambda r: d.sub808(r, H("A#", 0), 2.2, 2.5, 2.0, slide_from=H("F"), slide_time=0.15)),
            ("Kick punch", "kick", lambda r: d.kick(r, 170, 50, 0.035, 0.22, 2.2, 0.7, 0.5)),
            ("Kick sub", "kick", lambda r: d.kick(r, 120, 42, 0.05, 0.4, 1.6, 0.3, 0.8)),
            ("Clap hard", "clap", lambda r: d.clap(r, 4, 0.01, 1250, 1.1, 0.16, 0.7, 0.2, 1.8)),
            ("Clap stacked", "clap", lambda r: d.clap(r, 6, 0.008, 1500, 0.9, 0.22, 0.9, 0.3, 1.5)),
            ("Snare hard", "snare", lambda r: d.snare(r, 185, 0.8, 0.15, 1700, 0.5, 2.0)),
            ("Snare dark", "snare", lambda r: d.snare(r, 160, 0.9, 0.18, 1200, 0.6, 1.6, room=0.25)),
            ("Hat roll", "hat", lambda r: d.hat(r, 0.018, 1.1, 10000)),
            ("Hat crisp", "hat", lambda r: d.hat(r, 0.03, 1.05, 9500)),
            ("Hat dark", "hat", lambda r: d.hat(r, 0.04, 0.85, 7500)),
            ("Open hat", "open hat", lambda r: d.open_hat(r, 0.3, 1.0, 9000)),
            ("Rim", "snare", lambda r: d.rim(r, 1700)),
            ("Crash dark", "cymbal", lambda r: d.crash(r, 1.6, 0.9, 3.0, 0.6)),
            ("Stab C minor", "fx", lambda r: d.stab(r, H("C", 3), True, 2.0)),
            ("Brass hit G", "fx", lambda r: d.brass(r, H("G", 2), 1.8)),
            ("Reverse cymbal", "fx", lambda r: d.reverse(d.crash(r, 1.4, 1.0, 2.2, 0.4))),
            ("Impact low", "fx", lambda r: d.impact(r, 2.4)),
        ],
    },
    {
        "id": "bouncetheory", "name": "Bounce Theory kit", "by": "Wheezy", "genre": "Trap", "at": "2026-11-25T16:30:00Z",
        "about": "Punchy 808s with slides, snappy rims, toms and shakers for the bouncy, melodic trap Wheezy is known for.",
        "sounds": [
            ("808 punch E", "808", lambda r: d.sub808(r, H("E"), 1.3, 3.5, 2.2, tail=0.6)),
            ("808 punch G#", "808", lambda r: d.sub808(r, H("G#"), 1.2, 3.5, 2.2, tail=0.6)),
            ("808 slide up B", "808", lambda r: d.sub808(r, H("B"), 1.6, 3, 2.0, slide_from=H("F#"), slide_time=0.1)),
            ("Kick bounce", "kick", lambda r: d.kick(r, 180, 55, 0.025, 0.16, 2.0, 0.8, 0.4)),
            ("Snare snappy", "snare", lambda r: d.snare(r, 220, 0.6, 0.12, 2200, 0.4, 1.8)),
            ("Rim click", "snare", lambda r: d.rim(r, 1900)),
            ("Rim low", "snare", lambda r: d.rim(r, 1400)),
            ("Clap", "clap", lambda r: d.clap(r, 4, 0.01, 1350, 1.2, 0.14, 0.6, 0.15, 1.4)),
            ("Snap", "clap", lambda r: d.snap(r, 2200)),
            ("Hat", "hat", lambda r: d.hat(r, 0.028, 1.1, 9800)),
            ("Hat short", "hat", lambda r: d.hat(r, 0.014, 1.2, 11000)),
            ("Shaker", "hat", lambda r: d.shaker(r)),
            ("Open hat", "open hat", lambda r: d.open_hat(r, 0.18, 1.1, 9500)),
            ("Tom high", "perc", lambda r: d.tom(r, 200, 0.16)),
            ("Tom low", "perc", lambda r: d.tom(r, 110, 0.25)),
            ("Wood block", "perc", lambda r: d.wood(r, 1000)),
            ("Crash", "cymbal", lambda r: d.crash(r, 1.2, 1.05)),
        ],
    },
    {
        "id": "basement", "name": "Basement kit", "by": "Southside", "genre": "Trap", "at": "2026-11-25T16:00:00Z",
        "about": "Hard, distorted 808s, big snares and stacked claps for loud Atlanta trap in the 808 Mafia tradition Southside built.",
        "sounds": [
            ("808 hard C", "808", lambda r: d.sub808(r, H("C"), 1.9, 3, 3.2)),
            ("808 hard D", "808", lambda r: d.sub808(r, H("D"), 1.9, 3, 3.2)),
            ("808 hard F#", "808", lambda r: d.sub808(r, H("F#"), 1.7, 3, 3.4)),
            ("808 grit A", "808", lambda r: d.sub808(r, H("A", 0), 2.0, 3, 4.0, crush=8)),
            ("Kick hard", "kick", lambda r: d.kick(r, 175, 48, 0.03, 0.26, 3.0, 0.8, 0.55)),
            ("Snare big", "snare", lambda r: d.snare(r, 180, 0.9, 0.2, 1500, 0.6, 2.4, room=0.2)),
            ("Snare crack", "snare", lambda r: d.snare(r, 210, 0.6, 0.13, 2400, 0.45, 2.8)),
            ("Clap stack", "clap", lambda r: d.clap(r, 6, 0.01, 1200, 1.0, 0.2, 0.8, 0.25, 2.2)),
            ("Clap tight", "clap", lambda r: d.clap(r, 3, 0.008, 1500, 1.3, 0.09, 0.5, 0.1, 1.8)),
            ("Hat", "hat", lambda r: d.hat(r, 0.03, 1.0, 9000)),
            ("Hat bright", "hat", lambda r: d.hat(r, 0.022, 1.25, 11000)),
            ("Open hat", "open hat", lambda r: d.open_hat(r, 0.26, 1.0, 8800)),
            ("Perc knock", "perc", lambda r: d.tom(r, 260, 0.08, 0.35)),
            ("Crash", "cymbal", lambda r: d.crash(r, 1.4, 1.0)),
            ("Riser", "fx", lambda r: d.riser(r, 2.0)),
        ],
    },
    {
        "id": "memphisbounce", "name": "Memphis Bounce kit", "by": "Tay Keith", "genre": "Trap", "at": "2026-11-25T15:30:00Z",
        "about": "Knocking kicks, Memphis cowbells, sharp snares and busy hats for hard, bouncy Memphis trap in the style of Tay Keith.",
        "sounds": [
            ("808 knock D#", "808", lambda r: d.sub808(r, H("D#"), 1.4, 3.5, 2.6, tail=0.6)),
            ("808 knock G", "808", lambda r: d.sub808(r, H("G"), 1.3, 3.5, 2.6, tail=0.6)),
            ("808 long A#", "808", lambda r: d.sub808(r, H("A#", 0), 2.0, 3, 2.4)),
            ("Kick knock", "kick", lambda r: d.kick(r, 200, 55, 0.025, 0.2, 2.6, 0.9, 0.45)),
            ("Kick deep", "kick", lambda r: d.kick(r, 150, 45, 0.04, 0.3, 2.0, 0.5, 0.6)),
            ("Snare sharp", "snare", lambda r: d.snare(r, 235, 0.5, 0.12, 2600, 0.4, 2.2)),
            ("Clap Memphis", "clap", lambda r: d.clap(r, 4, 0.012, 1250, 1.0, 0.18, 0.7, 0.2, 1.6)),
            ("Cowbell", "perc", lambda r: d.cowbell(r, 560)),
            ("Cowbell low", "perc", lambda r: d.cowbell(r, 420, 0.7, 0.16)),
            ("Hat", "hat", lambda r: d.hat(r, 0.025, 1.1, 10000)),
            ("Hat tight", "hat", lambda r: d.hat(r, 0.012, 1.2, 11500)),
            ("Shaker", "hat", lambda r: d.shaker(r, 0.15)),
            ("Open hat", "open hat", lambda r: d.open_hat(r, 0.2, 1.05, 9400)),
            ("Rim", "snare", lambda r: d.rim(r, 1650)),
            ("Crash", "cymbal", lambda r: d.crash(r, 1.2, 1.1)),
        ],
    },
]


def seed_of(*parts: str) -> int:
    return zlib.crc32("/".join(parts).encode())


def write_sprite(path: Path, clips: list[np.ndarray]) -> list[tuple[float, float]]:
    parts, spans, pos = [np.zeros((int(0.1 * SR), 2))], [], int(0.1 * SR)
    for c in clips:
        spans.append((round(pos / SR, 4), round(len(c) / SR, 4)))
        parts += [c, np.zeros((int(GAP * SR), 2))]
        pos += len(c) + int(GAP * SR)
    pcm = (np.clip(np.concatenate(parts), -1, 1) * 32767).astype("<i2")
    tmp = path.with_suffix(".tmp.wav")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-codec:a", "libmp3lame", "-b:a", "160k", "-cutoff", "19000", "-map_metadata", "-1", str(path)], check=True)
    tmp.unlink()
    return spans


def main() -> None:
    OUT_MEDIA.mkdir(parents=True, exist_ok=True)
    for old in OUT_MEDIA.glob("*.mp3"):
        old.unlink()
    out = []
    for k in KITS:
        clips = []
        for name, cat, fn in k["sounds"]:
            rng = np.random.default_rng(seed_of(k["id"], name))
            x = fn(rng)
            # Hats and cymbals sit a little under the drums, the way a kit is usually levelled.
            trim_db = -4.0 if cat in ("hat", "open hat", "cymbal") else 0.0
            y = finish(x, -1.0, 0.0005, 0.02 if cat != "808" else 0.06) * (10 ** (trim_db / 20))
            clips.append((y * min(1.0, 0.7 / (np.max(np.abs(y)) + 1e-9))).astype(np.float32))
        file = f"{k['id']}.mp3"
        spans = write_sprite(OUT_MEDIA / file, clips)
        out.append({
            "id": k["id"], "name": k["name"], "inspiredBy": k["by"], "genre": k["genre"], "publishedAt": k["at"], "description": k["about"], "file": file,
            "sounds": [{"name": n, "category": c, "start": s, "duration": dur} for (n, c, _), (s, dur) in zip(k["sounds"], spans)],
        })
        print(f"{file}: {len(clips)} sounds, {(OUT_MEDIA / file).stat().st_size // 1024} KB")
    OUT_JSON.write_text(json.dumps({"kits": out}, indent=1) + "\n")


if __name__ == "__main__":
    main()
