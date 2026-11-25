#!/usr/bin/env python3
"""Checks the song MIDI batches (apps/web/src/demo/midi/song-batches/*.json) — the auditor's pass.

Usage: python3 scripts/check-song-batches.py [file ...]   (no args: every batch file)
Rejects: unreadable or mismatched voicings, missing sources or metadata, invented cover URLs, generic
arrangements (held block chords with no rhythm or bass movement), top lines that leave the chord
tones, and songs already in the library (song-chords.json or another batch).
"""
import glob, importlib.util, json, os, re, sys

HERE = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location("packs", os.path.join(HERE, "check-chord-packs.py"))
packs = importlib.util.module_from_spec(spec); spec.loader.exec_module(packs)
DEMO = os.path.join(HERE, "..", "apps/web/src/demo/midi")
BATCHES = os.path.join(DEMO, "song-batches")
TIMBRES = {"keys", "piano", "guitar", "acoustic", "organ", "synth", "pad", "strings", "choir", "flute", "pluck", "bell"}
GENRES = {"hip-hop", "trap", "pop", "rnb", "neo soul", "soul", "funk", "disco", "edm", "house", "rock", "indie", "alternative",
          "classics", "afrobeats", "latin", "reggaeton", "jazz", "gospel", "country", "reggae", "k-pop", "lo-fi", "drill"}
RHYTHMS = packs.RHYTHMS

def norm(s):
    s = s.lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)
    s = re.split(r" feat\.? | ft\.? | featuring | with | x |,| & ", s)[0]
    return re.sub(r"[^a-z0-9]", "", s)

def key_of(song, artist):
    return norm(song) + "|" + norm(artist)

def chord_pcs(sym, notes):
    return {n % 12 for n in notes}

def check(path, errs, seen):
    try:
        data = json.load(open(path))
    except Exception as e:
        errs.append(f"{path}: not valid JSON: {e}"); return 0
    if not isinstance(data, list):
        errs.append(f"{path}: top level must be a list of songs"); return 0
    for i, s in enumerate(data):
        w = f"{os.path.basename(path)}#{i} {s.get('song','?')!r} by {s.get('artist','?')!r}"
        req = ["song", "artist", "album", "year", "genre", "key", "bpm", "meter", "section", "chordSource", "keyBpmSource", "timbre", "instrument", "cover", "chords", "bass", "notes"]
        miss = [f for f in req if f not in s]
        if miss:
            errs.append(f"{w}: missing {', '.join(miss)}"); continue
        k = key_of(s["song"], s["artist"])
        if k in seen:
            errs.append(f"{w}: already in the library ({seen[k]})")
        seen[k] = w
        if s["meter"] != "4/4":
            errs.append(f"{w}: only 4/4 songs for now (meter {s['meter']!r})")
        if not packs.KEY.match(s["key"]):
            errs.append(f"{w}: key {s['key']!r} must look like 'C# minor' or 'Eb major'")
        if not (55 <= s["bpm"] <= 200):
            errs.append(f"{w}: bpm {s['bpm']} outside 55..200")
        if s["genre"] not in GENRES:
            errs.append(f"{w}: genre {s['genre']!r} not one of {sorted(GENRES)}")
        if not (isinstance(s["year"], int) and 1940 <= s["year"] <= 2026):
            errs.append(f"{w}: year must be an int 1940..2026")
        if s["timbre"] not in TIMBRES:
            errs.append(f"{w}: timbre {s['timbre']!r} not one of {sorted(TIMBRES)}")
        for f in ("chordSource",):
            src = s[f]
            if not (isinstance(src, dict) and src.get("label") and str(src.get("url", "")).startswith("https://")):
                errs.append(f"{w}: {f} needs label and an https url of the page the chords were read from")
        c = s["cover"]
        if c is not None:
            if not (isinstance(c, dict) and c.get("album") and re.match(r"^https://is\d-ssl\.mzstatic\.com/image/thumb/.+/600x600bb\.jpg$", c.get("artwork", "")) and str(c.get("albumUrl", "")).startswith("https://music.apple.com/")):
                errs.append(f"{w}: cover must be null or {{album, albumUrl (music.apple.com), artwork (mzstatic 600x600bb.jpg)}} copied from scripts/songs/itunes.py output")
        total, spans = 0, []
        for j, ch in enumerate(s["chords"]):
            if not (isinstance(ch, list) and len(ch) == 3):
                errs.append(f"{w}: chord {j} must be [symbol, beats, [notes]]"); continue
            packs.check_chord(f"{w} chord {j}", ch[0], ch[1], ch[2], errs)
            spans.append((total, total + ch[1], ch[2]))
            total += ch[1] if isinstance(ch[1], (int, float)) else 0
        if total not in (8, 16, 32):
            errs.append(f"{w}: chord beats add up to {total}; must be 8, 16 or 32 (2, 4 or 8 bars)")
        if len({ch[0] for ch in s["chords"] if isinstance(ch, list)}) < 2:
            errs.append(f"{w}: needs at least 2 different chords")
        hits, rhythm = s.get("hits"), s.get("rhythm")
        if hits is None and rhythm not in RHYTHMS:
            errs.append(f"{w}: give 'hits' (a one-bar strike pattern) or a 'rhythm' preset")
        if hits is not None:
            if not (isinstance(hits, list) and hits and all(isinstance(h, list) and len(h) == 2 and 0 <= h[0] < 4 and h[1] > 0 and h[0] + h[1] <= 4.01 for h in hits)):
                errs.append(f"{w}: hits must be [[start, length], ...] inside one 4-beat bar")
        bass = s["bass"]
        if not (isinstance(bass, list) and bass and all(isinstance(b, list) and len(b) == 3 and 0 <= b[0] < 4 and b[1] > 0 and b[0] + b[1] <= 4.01 and b[2] in (-12, 0, 12) for b in bass)):
            errs.append(f"{w}: bass must be [[start, length, octave -12|0|12], ...] inside one 4-beat bar")
        # Anti-generic: held whole-bar block chords with a held bass is what this database replaces.
        generic_upper = (hits is None and rhythm == "held") or (hits is not None and len(hits) == 1 and hits[0][0] == 0 and hits[0][1] >= 3.5)
        generic_bass = isinstance(bass, list) and len(bass) == 1 and bass[0][0] == 0 and bass[0][1] >= 3.5
        if generic_upper and generic_bass:
            errs.append(f"{w}: generic arrangement (held block chords over a held bass); give the chords or the bass the record's rhythm")
        sw = s.get("swing", 0)
        if not (isinstance(sw, (int, float)) and 0 <= sw <= 0.6):
            errs.append(f"{w}: swing must be 0..0.6")
        for t in s.get("top", []) or []:
            if not (isinstance(t, list) and len(t) == 3 and 0 <= t[0] < total and t[1] > 0 and t[0] + t[1] <= total + 0.01 and 55 <= t[2] <= 96):
                errs.append(f"{w}: top note {t} must be [start, length, pitch] inside the loop"); continue
            under = [sp for sp in spans if sp[0] <= t[0] < sp[1]]
            if under and t[2] % 12 not in chord_pcs(None, under[0][2]):
                errs.append(f"{w}: top note {t} is not a tone of the chord under it (top lines are chord-tone contours, not the record's melody)")
        if len(s.get("top", []) or []) > total * 1.5:
            errs.append(f"{w}: top line too busy ({len(s['top'])} notes); keep it a contour")
    return len(data)

def main():
    seen = {}
    for x in json.load(open(os.path.join(DEMO, "song-chords.json"))):
        seen[key_of(x["song"], x["artist"])] = "song-chords.json"
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(BATCHES, "*.json")))
    if sys.argv[1:]:
        # Other batches still count as the library.
        for f in sorted(glob.glob(os.path.join(BATCHES, "*.json"))):
            if os.path.abspath(f) not in {os.path.abspath(a) for a in files}:
                try:
                    for x in json.load(open(f)):
                        seen[key_of(x.get("song", ""), x.get("artist", ""))] = os.path.basename(f)
                except Exception:
                    pass
    errs, n = [], 0
    for f in files:
        n += check(f, errs, seen)
    for e in errs:
        print(e)
    print(f"{n} songs in {len(files)} files, {len(errs)} problems")
    sys.exit(1 if errs else 0)

if __name__ == "__main__":
    main()
