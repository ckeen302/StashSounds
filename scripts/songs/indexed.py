#!/usr/bin/env python3
"""Lists every song already in the MIDI library (song-chords.json and every song batch), one
"Song — Artist" per line, so a new batch can skip them. Optional filter: python3 scripts/songs/indexed.py <word>"""
import glob, json, os, sys
d = os.path.join(os.path.dirname(__file__), "..", "..", "apps/web/src/demo/midi")
rows = [(x["song"], x["artist"]) for x in json.load(open(os.path.join(d, "song-chords.json")))]
for f in sorted(glob.glob(os.path.join(d, "song-batches", "*.json"))):
    try:
        rows += [(x.get("song", ""), x.get("artist", "")) for x in json.load(open(f))]
    except Exception:
        pass
q = (sys.argv[1] if len(sys.argv) > 1 else "").lower()
for s, a in sorted(set(rows), key=lambda r: (r[1].lower(), r[0].lower())):
    if q in f"{s} {a}".lower():
        print(f"{s} — {a}")
print(f"({len(set(rows))} songs)", file=sys.stderr)
