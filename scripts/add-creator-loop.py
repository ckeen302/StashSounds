#!/usr/bin/env python3
"""Adds a producer's own loop to the demo (ticket 137): a loudness-matched mp3 preview and an entry
with its peaks in apps/web/src/demo/creator/loops.json. The preview is committed under
apps/web/src/demo/creator/media/ (public/demo/ is gitignored); scripts/build-demo-app.mjs copies it.

Usage: python3 scripts/add-creator-loop.py <audio> <entry.json>
  entry.json: {"slug", "title", "owner": {"handle", "displayName"}, "bpm", "bars", "key": {"root","mode"},
               "tags", "genre", "description", "license", "publishedAt"}
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("gen", ROOT / "scripts/gen-demo-loops.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

OUT_DIR = ROOT / "apps/web/src/demo/creator"
OUT_JSON = OUT_DIR / "loops.json"


def main():
    src, entry_path = Path(sys.argv[1]), Path(sys.argv[2])
    e = json.loads(entry_path.read_text())
    sr = gen.SR
    loop_samples = round(e["bars"] * 4 * 60 / e["bpm"] * sr)
    duration_ms = round(loop_samples / sr * 1000)
    p = gen.LIMITS["preview"]
    kbps = p["loopBitrateKbpsShort"] if duration_ms <= p["loopShortMaxMs"] else p["loopBitrateKbpsLong"]
    mp3 = OUT_DIR / "media" / f"{e['slug']}.mp3"
    mp3.parent.mkdir(parents=True, exist_ok=True)
    gen.ffmpeg(["-i", str(src), "-af", f"{gen.loudnorm(src)},aresample={sr}", "-ar", str(sr), "-ac", "2", "-t", f"{loop_samples / sr:.6f}",
                "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-f", "mp3", "-y", str(mp3)])
    size = mp3.stat().st_size
    if size > p["loopMaxBytes"]:
        raise SystemExit(f"preview {size} B is over limits.preview.loopMaxBytes")
    row = {
        **{k: e[k] for k in ("slug", "bpm", "bars", "key")},
        "loopSamples": loop_samples,
        "sampleRate": sr,
        "durationMs": duration_ms,
        "preview": {"path": f"demo/media/{e['slug']}.mp3", "bytes": size, "sha256": hashlib.sha256(mp3.read_bytes()).hexdigest(), "kbps": kbps},
        "peaks": gen.peaks(mp3, gen.LIMITS["waveform"]["peakPoints"]),
        "copy": {k: e[k] for k in ("title", "owner", "tags", "genre", "description", "license", "publishedAt")},
    }
    data = json.loads(OUT_JSON.read_text()) if OUT_JSON.exists() else {"$comment": "Written by scripts/add-creator-loop.py. Producers' own loops.", "loops": []}
    data["loops"] = [l for l in data["loops"] if l["slug"] != e["slug"]] + [row]
    OUT_JSON.write_text(json.dumps(data, indent=2) + "\n")
    print(f"{e['slug']}: {e['bpm']} BPM, {e['bars']} bars, {duration_ms} ms, {kbps} kbps, {size} B")


if __name__ == "__main__":
    main()
