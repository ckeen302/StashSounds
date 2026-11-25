#!/usr/bin/env python3
"""Checks the demo's chord-pack files (apps/web/src/demo/midi/chord-packs/*.json).

Usage: python3 scripts/check-chord-packs.py [file ...]   (no args: every pack file)
Prints one line per problem and exits 1 if there are any.
"""
import json, re, sys, glob, os

ROOT = os.path.join(os.path.dirname(__file__), "..", "apps/web/src/demo/midi/chord-packs")
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
RHYTHMS = {"held", "roll", "push", "stabs", "pulse", "arp", "bounce"}
SYM = re.compile(r"^([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?$")
QUAL = re.compile(r"^(maj|m|min|dim|aug|sus2|sus4|sus|add|6|7|9|11|13|5|M|\+|°|ø|[#b]|\(|\)|,|\d)*$")
KEY = re.compile(r"^([A-G][#b]?) (major|minor)$")

def pc(n):
    v = NOTE[n[0]]
    for a in n[1:]:
        v += 1 if a == "#" else -1
    return v % 12

def check_chord(where, sym, beats, notes, errs):
    m = SYM.match(sym)
    if not m:
        errs.append(f"{where}: can't read chord symbol {sym!r}")
        return
    root, q, slash = pc(m.group(1)), m.group(2), m.group(3)
    if not QUAL.match(q):
        errs.append(f"{where}: unknown chord quality in {sym!r}")
    if not isinstance(notes, list) or len(notes) < 4 or not all(isinstance(n, int) for n in notes):
        errs.append(f"{where}: {sym} needs a bass note plus at least 3 upper notes (MIDI ints)")
        return
    if notes != sorted(notes) or len(set(notes)) != len(notes):
        errs.append(f"{where}: {sym} notes must be strictly low to high")
    bass, upper = notes[0], notes[1:]
    want_bass = pc(slash) if slash else root
    if bass % 12 != want_bass:
        errs.append(f"{where}: {sym} bass {bass} is pitch class {bass%12}, expected {want_bass}")
    if not (24 <= bass <= 52):
        errs.append(f"{where}: {sym} bass {bass} outside 24..52")
    if not all(48 <= n <= 86 for n in upper):
        errs.append(f"{where}: {sym} upper notes {upper} outside 48..86")
    if upper[0] - bass < 5:
        errs.append(f"{where}: {sym} upper voicing sits on top of the bass (gap < 5 semitones)")
    rel = {(n - root) % 12 for n in upper}
    minor = bool(re.match(r"^(m(?!aj)|min|dim|ø)", q))
    sus = "sus" in q or q.startswith("5")
    if not sus:
        third = 3 if minor else 4
        if third not in rel:
            errs.append(f"{where}: {sym} voicing is missing its {'minor' if minor else 'major'} third")
        wrong = 4 if minor else 3
        if wrong in rel and "#9" not in q and not (not minor and "b10" in q):
            errs.append(f"{where}: {sym} voicing has the wrong third ({'major' if minor else 'minor'})")
    has7 = re.search(r"(7|9|11|13)", q) and not re.search(r"add(9|11|13)|6/9|69", q)
    if has7:
        maj7 = "maj" in q or "M7" in q or "M9" in q
        dim7 = "dim7" in q
        want = 11 if maj7 else (9 if dim7 else 10)
        if want not in rel:
            errs.append(f"{where}: {sym} voicing is missing its seventh")
    if not (isinstance(beats, (int, float)) and beats > 0 and (beats * 2) == int(beats * 2)):
        errs.append(f"{where}: {sym} beats must be a positive multiple of 0.5")

def check_file(path, errs, titles):
    try:
        data = json.load(open(path))
    except Exception as e:
        errs.append(f"{path}: not valid JSON: {e}")
        return 0
    if not isinstance(data, dict) or "packs" not in data or "progressions" not in data:
        errs.append(f"{path}: top level must be {{\"packs\": [...], \"progressions\": [...]}}")
        return 0
    packs = {p.get("name") for p in data["packs"]}
    for p in data["packs"]:
        if not p.get("name") or not p.get("description") or not p.get("style"):
            errs.append(f"{path}: pack needs name, style, description: {p}")
    for i, p in enumerate(data["progressions"]):
        w = f"{os.path.basename(path)}#{i} {p.get('title','?')!r}"
        for f in ("title", "pack", "bpm", "key", "tags", "rhythm", "chords", "description"):
            if f not in p:
                errs.append(f"{w}: missing {f}")
        if any(f not in p for f in ("title", "bpm", "key", "chords")):
            continue
        t = p["title"].strip().lower()
        if t in titles:
            errs.append(f"{w}: title already used ({titles[t]})")
        titles[t] = w
        if p.get("pack") not in packs:
            errs.append(f"{w}: pack {p.get('pack')!r} not in this file's packs")
        if not (55 <= p["bpm"] <= 180):
            errs.append(f"{w}: bpm {p['bpm']} outside 55..180")
        if not KEY.match(p["key"]):
            errs.append(f"{w}: key {p['key']!r} must look like 'F# minor' or 'Eb major'")
        if p.get("rhythm") not in RHYTHMS:
            errs.append(f"{w}: rhythm {p.get('rhythm')!r} not one of {sorted(RHYTHMS)}")
        tags = p.get("tags", [])
        if not (2 <= len(tags) <= 5) or any(t != t.lower() for t in tags):
            errs.append(f"{w}: 2 to 5 lowercase tags")
        total = 0
        for j, c in enumerate(p["chords"]):
            if not (isinstance(c, list) and len(c) == 3):
                errs.append(f"{w}: chord {j} must be [symbol, beats, [notes]]")
                continue
            check_chord(f"{w} chord {j}", c[0], c[1], c[2], errs)
            total += c[1] if isinstance(c[1], (int, float)) else 0
        if total not in (16, 32):
            errs.append(f"{w}: chord beats add up to {total}; must be 16 (4 bars) or 32 (8 bars)")
        if len({c[0] for c in p["chords"] if isinstance(c, list)}) < 3:
            errs.append(f"{w}: needs at least 3 different chords")
        for k, n in enumerate(p.get("top", []) or []):
            if not (isinstance(n, list) and len(n) == 3 and 0 <= n[0] < total and n[1] > 0 and n[0] + n[1] <= total + 0.01 and 55 <= n[2] <= 96):
                errs.append(f"{w}: top note {k} {n} must be [start, length, pitch] inside the loop, pitch 55..96")
    return len(data["progressions"])

def main():
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(ROOT, "*.json")))
    errs, titles, n = [], {}, 0
    for f in files:
        n += check_file(f, errs, titles)
    for e in errs:
        print(e)
    print(f"{n} progressions in {len(files)} files, {len(errs)} problems")
    sys.exit(1 if errs else 0)

if __name__ == "__main__":
    main()
