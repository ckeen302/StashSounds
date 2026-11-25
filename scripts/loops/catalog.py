"""The loop library's plan: which progressions become which loops, arranged how.

Each recipe takes a progression (from the demo's chord packs) and a seeded random generator and
returns the loop's tracks, its instrument tags and a sentence describing what plays. build.py renders
them. Change a recipe or a seed and the loop changes; nothing here is random between runs.
"""
import re

import numpy as np

import compose as C

NAMES = {
    "grand": "grand piano", "fmpiano": "electric piano", "vibes": "vibraphone", "glock": "glockenspiel", "marimba": "marimba",
    "kalimba": "kalimba", "tubular": "tubular bells", "chimes": "hand chimes", "organ": "pipe organ", "harp": "harp",
    "sax": "tenor sax", "strings": "violin section", "violas": "viola section", "celli": "cello section", "spic": "spiccato violins",
    "cellospic": "spiccato celli", "pizz": "pizzicato violins", "flute": "flute", "flutestac": "staccato flute", "horn": "french horn",
    "trombone": "trombone", "bass": "upright bass", "pluggbell": "plugg bell", "softbell": "soft bell", "musicbox": "music box",
    "lead": "square lead", "pluggLead": "soft square lead", "supersaw": "supersaw", "ragelead": "distorted supersaw lead",
    "ragebrass": "synth brass", "pluck": "synth pluck", "pad": "pad", "darkpad": "dark pad", "warmpad": "warm pad", "choir": "synth choir",
    "cowbell": "808 cowbell", "epiano": "FM keys", "guitar": "nylon guitar", "eguitar": "clean guitar", "sawbass": "saw bass",
}
TAGS = {
    "grand": "piano", "fmpiano": "rhodes", "vibes": "vibes", "glock": "bells", "marimba": "marimba", "kalimba": "kalimba",
    "tubular": "bells", "chimes": "bells", "organ": "organ", "harp": "harp", "sax": "sax", "strings": "strings", "violas": "strings",
    "celli": "strings", "spic": "strings", "cellospic": "strings", "pizz": "strings", "flute": "flute", "flutestac": "flute",
    "horn": "brass", "trombone": "brass", "bass": "bass", "pluggbell": "bells", "softbell": "bells", "musicbox": "music box",
    "lead": "lead", "pluggLead": "lead", "supersaw": "synth", "ragelead": "lead", "ragebrass": "synth", "pluck": "pluck", "pad": "pad",
    "darkpad": "pad", "warmpad": "pad", "choir": "choir", "cowbell": "cowbell", "epiano": "keys", "guitar": "guitar", "eguitar": "guitar",
}


def S(inst, notes, role, fx=(), gain=0.0, **kw):
    return {"name": f"{inst}-{role}", "kind": "sampled", "inst": inst, "notes": notes, "role": role, "fx": list(fx), "gain": gain, **kw}


def Y(inst, notes, role, fx=(), gain=0.0, **kw):
    return {"name": f"{inst}-{role}", "kind": "synth", "inst": inst, "notes": notes, "role": role, "fx": list(fx), "gain": gain, "humanize": kw.pop("humanize", 0.0), **kw}


def lead_range(inst):
    return {"flute": (69, 93), "glock": (81, 100), "tubular": (72, 89), "chimes": (72, 92), "vibes": (65, 86), "marimba": (64, 88),
            "kalimba": (62, 83), "strings": (67, 88), "spic": (67, 88), "pizz": (67, 88), "sax": (58, 80), "horn": (55, 74),
            "harp": (64, 88), "grand": (67, 88), "fmpiano": (64, 84)}.get(inst, (67, 88))


HALL = ("reverb", 0.32, 2.8)
ROOM = ("reverb", 0.18, 1.2)
PLATE = ("reverb", 0.26, 1.8, 0.01, 8000)
BIG = ("reverb", 0.45, 4.2, 0.03)


def dly(beats=0.75, fb=0.3, mix=0.2):
    return ("delay", beats, fb, mix)


# ---------- recipes: each returns (tracks, instruments, sentence) ----------


def r_dark_piano(p, g):
    lead, top = C.lead_line(p, "trap", g, 79, 98, vel=88)
    bell = g.choice(["glock", "tubular", "chimes", "musicbox"])
    lead_tr = S(bell, lead, "lead", [dly(0.75, 0.32, 0.22), HALL]) if bell != "musicbox" else Y("musicbox", lead, "lead", [dly(0.75, 0.32, 0.22), HALL])
    tracks = [
        S("grand", C.chord_part(p, g.choice(["held", "halves", "push"]), 52, 79, vel=78, bass=True, bass_oct=(36, 50), strum=0.015), "chords", [("lp", 6500), ("eq", "lowshelf", 200, -3), HALL]),
        lead_tr,
        Y("darkpad", C.chord_part(p, "held", 48, 72, vel=70), "pad", [("lp", 1400), BIG], gain=-1),
    ]
    return tracks, ["grand", bell, "darkpad"], f"Steinway grand voicings with a {NAMES[bell]} hook {'from the pack top line' if top else 'on top'} and a dark pad underneath."


def r_piano_strings(p, g):
    lead, _ = C.lead_line(p, "trap", g, 67, 86, vel=96)
    tracks = [
        S("grand", lead, "lead", [("lp", 8000), HALL], gain=0),
        S("strings", C.chord_part(p, "held", 60, 84, vel=82, drop_top=False), "pad", [("lp", 7000), BIG], gain=1, release=0.6),
        S("celli", [(s, b * 0.98, C.fit(v[0], 36, 52), 90) for (s, b, _, v) in p.chords], "bass", [HALL], gain=-2, release=0.6),
    ]
    return tracks, ["grand", "strings", "celli"], "A grand piano melody over a held violin section, with celli doubling the root."


def r_flute(p, g):
    lead, _ = C.lead_line(p, "flute", g, 72, 93, vel=100)
    tracks = [
        S("flute", lead, "lead", [dly(0.5, 0.25, 0.16), HALL], humanize=0.004),
        Y(g.choice(["choir", "darkpad"]), C.chord_part(p, "held", 55, 76, vel=72), "pad", [BIG]),
        S("harp", C.arp(p, 0.5, g.choice(["up", "skip", "updown"]), 52, 84, vel=72, octaves=2), "arp", [HALL], gain=-1),
    ]
    return tracks, ["flute", tracks[1]["inst"], "harp"], "A breathy flute hook with harp arpeggios and a soft choir bed."


def r_orchestral(p, g):
    lead, _ = C.lead_line(p, "trap", g, 55, 74, vel=100)
    tracks = [
        S("horn", lead, "lead", [HALL], release=0.4),
        S("spic", C.arp(p, 0.25, "pedal", 62, 86, vel=88, octaves=1, gate=0.7), "arp", [HALL], gain=-1),
        S("strings", C.chord_part(p, "held", 60, 84, vel=80), "pad", [BIG], release=0.6),
        S("celli", [(s, b * 0.98, C.fit(v[0], 36, 52), 95) for (s, b, _, v) in p.chords], "bass", [HALL], gain=-1, release=0.6),
    ]
    return tracks, ["horn", "spic", "strings", "celli"], "Orchestral trap: a french horn theme over driving spiccato violins, held strings and celli."


def r_organ(p, g):
    lead, _ = C.lead_line(p, "trap", g, 67, 86, vel=96)
    tracks = [
        S("organ", C.chord_part(p, "held", 52, 76, vel=80, bass=True, bass_oct=(36, 48)), "chords", [("lp", 5000), BIG], gain=-1),
        S("grand", lead, "lead", [("lp", 7000), HALL]),
        Y("choir", C.chord_part(p, "held", 60, 79, vel=70), "pad", [BIG], gain=-2),
    ]
    return tracks, ["organ", "grand", "choir"], "A church organ under a single-note piano line, with a choir pad filling the top."


def r_kalimba(p, g):
    k = g.choice(["kalimba", "marimba", "vibes"])
    lo, hi = lead_range(k)
    tracks = [
        S(k, C.arp(p, 0.25 if k != "vibes" else 0.5, g.choice(["skip", "updown", "pedal"]), lo, hi, vel=90, octaves=2, gate=0.8), "arp", [dly(0.75, 0.28, 0.18), HALL]),
        Y("warmpad", C.chord_part(p, "held", 50, 72, vel=70), "pad", [BIG], gain=-1),
        S("grand", C.chord_part(p, "held", 48, 70, vel=60, strum=0.03), "chords", [("lp", 4500), HALL], gain=-4),
    ]
    return tracks, [k, "warmpad", "grand"], f"A melodic trap {NAMES[k]} pattern bouncing over a warm pad and soft piano chords."


def r_guitar(p, g):
    lead, _ = C.lead_line(p, "rnb", g, 64, 84, vel=92)
    tracks = [
        Y("guitar", C.arp(p, 0.5, g.choice(["up", "skip", "updown"]), 50, 79, vel=95, octaves=2, gate=1.6), "arp", [("eq", "peak", 3000, 2, 1), PLATE], humanize=0.008),
        Y("guitar", lead, "lead", [dly(0.75, 0.25, 0.15), PLATE], humanize=0.008),
        Y("warmpad", C.chord_part(p, "held", 50, 72, vel=60), "pad", [BIG], gain=-3),
    ]
    return tracks, ["guitar", "warmpad"], "Fingerpicked nylon guitar arpeggios with a guitar lead answering on top."


# plugg / pluggnb


def r_plugg_bells(p, g):
    lead, _ = C.lead_line(p, "plugg", g, 74, 93, vel=96)
    tracks = [
        Y("pluggbell", lead, "lead", [dly(0.75, 0.35, 0.22), PLATE]),
        Y("pad", C.chord_part(p, g.choice(["bounce", "held"]), 55, 79, vel=80), "pad", [("chorus",), PLATE], gain=1),
        Y("softbell", C.arp(p, 0.5, "updown", 72, 96, vel=70, octaves=1), "counter", [dly(0.5, 0.3, 0.2), HALL], gain=-2),
    ]
    return tracks, ["pluggbell", "pad", "softbell"], "A plugg bell hook over bouncing pad chords, with soft bells trading eighths up high."


def r_plugg_lead(p, g):
    lead, _ = C.lead_line(p, "plugg", g, 67, 86, vel=100)
    tracks = [
        Y("pluggLead", [(*n, True) if i % 4 == 3 else n for i, n in enumerate(lead)], "lead", [dly(0.75, 0.3, 0.2), PLATE]),
        Y("musicbox", C.arp(p, 0.25, g.choice(["up", "skip"]), 79, 100, vel=70, octaves=1), "arp", [HALL], gain=-2),
        Y("warmpad", C.chord_part(p, "held", 55, 76, vel=75), "pad", [("chorus",), BIG]),
    ]
    return tracks, ["pluggLead", "musicbox", "warmpad"], "A soft square lead with little slides, a music box arp and a warm pad."


def r_pluggnb(p, g):
    lead, _ = C.lead_line(p, "plugg", g, 72, 91, vel=92)
    tracks = [
        S("fmpiano", C.chord_part(p, g.choice(["bounce", "push", "held"]), 52, 79, vel=88, strum=0.01), "chords", [("chorus", 2.5, 0.5, 0.4), PLATE]),
        Y("pluggbell", lead, "lead", [dly(0.75, 0.32, 0.2), PLATE]),
        S("vibes", C.arp(p, 0.5, "updown", 67, 88, vel=70, octaves=1), "counter", [HALL], gain=-3),
    ]
    return tracks, ["fmpiano", "pluggbell", "vibes"], "Pluggnb: chorused electric piano chords, a plugg bell melody and a vibraphone answer."


def r_plugg_marimba(p, g):
    tracks = [
        S("marimba", C.arp(p, 0.25, g.choice(["skip", "pedal", "updown"]), 60, 88, vel=92, octaves=2, gate=0.9), "lead", [dly(0.75, 0.25, 0.15), PLATE]),
        Y("pad", C.chord_part(p, "held", 55, 79, vel=75), "pad", [("chorus",), BIG]),
        Y("softbell", C.lead_line(p, "plugg", g, 79, 96, vel=80)[0], "counter", [dly(0.75, 0.35, 0.25), HALL], gain=-2),
    ]
    return tracks, ["marimba", "pad", "softbell"], "A busy marimba riff with bells floating over a wide pad."


# rage


def r_rage_lead(p, g):
    lo, hi = 62, 84
    riff = C.melody(p, C.CELLS["rage"], g, lo, hi, vel=110)
    tracks = [
        Y("ragelead", riff, "lead", [dly(0.5, 0.25, 0.12), PLATE]),
        Y("supersaw", C.chord_part(p, "held", 55, 79, vel=80), "pad", [("width", 1.4), BIG], gain=-1),
        Y("pluck", C.arp(p, 0.25, "up", 72, 96, vel=80, octaves=1), "arp", [dly(0.75, 0.3, 0.2), PLATE], gain=-3),
    ]
    return tracks, ["ragelead", "supersaw", "pluck"], "A distorted supersaw riff over wide supersaw chords, with a synth pluck arp."


def r_rage_brass(p, g):
    tracks = [
        Y("ragebrass", C.chord_part(p, "stabs", 55, 79, vel=105), "chords", [("sat", 1.8), PLATE]),
        S("glock", C.arp(p, 0.25, g.choice(["skip", "up"]), 81, 100, vel=85, octaves=1), "arp", [dly(0.75, 0.3, 0.2), HALL], gain=-1),
        Y("darkpad", C.chord_part(p, "held", 48, 72, vel=70), "pad", [BIG], gain=-3),
    ]
    return tracks, ["ragebrass", "glock", "darkpad"], "Syncopated synth brass stabs with a glockenspiel arp cutting through the top."


def r_rage_arp(p, g):
    lead = C.melody(p, C.CELLS["rage"], g, 67, 88, vel=105)
    tracks = [
        Y("pluck", C.arp(p, 0.25, g.choice(["updown", "skip", "pedal"]), 60, 88, vel=100, octaves=2), "arp", [("crush", 10, 2), dly(0.75, 0.3, 0.2), PLATE]),
        Y("lead", lead, "lead", [dly(0.5, 0.3, 0.18), PLATE], gain=-1),
        Y("supersaw", C.chord_part(p, "held", 55, 79, vel=70), "pad", [("width", 1.4), BIG], gain=-3),
    ]
    return tracks, ["pluck", "lead", "supersaw"], "A bitcrushed sixteenth-note synth arp, a square lead on top and supersaw chords behind."


def r_phonk(p, g):
    lead = C.melody(p, C.CELLS["rage"], g, 64, 84, vel=110)
    tracks = [
        Y("cowbell", lead, "lead", [("sat", 2.0), PLATE]),
        Y("darkpad", C.chord_part(p, "held", 48, 72, vel=75), "pad", [("lofi",), BIG], gain=-1),
        S("organ", C.chord_part(p, "held", 55, 76, vel=65), "chords", [("telephone",), HALL], gain=-6),
    ]
    return tracks, ["cowbell", "darkpad", "organ"], "Drift phonk: a saturated 808 cowbell melody over a tape-worn pad and a filtered organ."


# rnb / soul / lofi


def r_rnb_keys(p, g):
    lead, _ = C.lead_line(p, "rnb", g, 65, 86, vel=86)
    tracks = [
        S("fmpiano", C.chord_part(p, g.choice(["held", "push", "roll"]), 50, 79, vel=90, bass=True, bass_oct=(36, 50), strum=0.03), "chords", [("chorus", 3, 0.45, 0.45), PLATE]),
        S("vibes", lead, "lead", [dly(0.75, 0.25, 0.15), HALL]),
        S("strings", C.chord_part(p, "held", 64, 86, vel=60), "pad", [BIG], gain=-4, release=0.8),
    ]
    return tracks, ["fmpiano", "vibes", "strings"], "Electric piano chords with a vibraphone melody and strings swelling in the back."


def r_rnb_guitar(p, g):
    tracks = [
        Y("eguitar", C.arp(p, 0.5, g.choice(["up", "skip"]), 55, 81, vel=92, octaves=2, gate=1.4), "arp", [dly(0.75, 0.3, 0.2), PLATE], humanize=0.008),
        S("fmpiano", C.chord_part(p, "held", 50, 76, vel=78, strum=0.03), "chords", [("chorus",), PLATE], gain=-2),
        Y("warmpad", C.chord_part(p, "held", 55, 76, vel=60), "pad", [BIG], gain=-4),
    ]
    return tracks, ["eguitar", "fmpiano", "warmpad"], "A clean chorused guitar picking through the changes, electric piano and pad under it."


def r_rnb_harp(p, g):
    lead, _ = C.lead_line(p, "rnb", g, 72, 93, vel=90)
    tracks = [
        S("harp", C.arp(p, 1 / 3, "updown", 52, 86, vel=85, octaves=2), "arp", [HALL]),
        S("flute", lead, "lead", [dly(0.75, 0.25, 0.15), HALL], gain=-1),
        S("violas", C.chord_part(p, "held", 55, 79, vel=70), "pad", [BIG], gain=-3, release=0.7),
    ]
    return tracks, ["harp", "flute", "violas"], "Harp triplets under a flute line, held violas filling the middle."


def r_soul(p, g):
    lead, _ = C.lead_line(p, "rnb", g, 60, 79, vel=95)
    tracks = [
        S("grand", C.chord_part(p, g.choice(["push", "held", "pulse"]), 52, 79, vel=85, bass=True, bass_oct=(36, 50), strum=0.02), "chords", [("lp", 7000), ROOM]),
        S("sax", lead, "lead", [PLATE], release=0.2),
        S("organ", C.chord_part(p, "held", 55, 76, vel=60), "pad", [("lp", 3000), ROOM], gain=-5),
    ]
    return tracks, ["grand", "sax", "organ"], "Neo soul: piano chords, a tenor sax line and an organ pad, recorded close."


def r_soul_keys(p, g):
    tracks = [
        S("fmpiano", C.chord_part(p, g.choice(["push", "roll", "held"]), 50, 79, vel=92, bass=True, bass_oct=(36, 50), strum=0.03), "chords", [("chorus", 3, 0.45, 0.4), PLATE]),
        S("bass", [(s, b * 0.95, C.fit(v[0], 36, 52), 100) for (s, b, _, v) in p.chords], "bass", [ROOM]),
        S("vibes", C.lead_line(p, "rnb", g, 67, 86, vel=80)[0], "lead", [HALL], gain=-2),
    ]
    return tracks, ["fmpiano", "bass", "vibes"], "Rhodes-style chords with a plucked upright bass and a vibraphone line."


def r_lofi(p, g):
    k = g.choice(["fmpiano", "grand"])
    lead, _ = C.lead_line(p, "lofi", g, 67, 86, vel=80)
    tracks = [
        S(k, C.chord_part(p, g.choice(["held", "push", "roll"]), 50, 77, vel=82, bass=True, bass_oct=(36, 50), strum=0.035), "chords", [("lofi",), ROOM]),
        S(g.choice(["vibes", "kalimba", "glock"]), lead, "lead", [("lofi",), HALL], gain=-1),
    ]
    return tracks, [k, tracks[1]["inst"]], f"Lo-fi {NAMES[k]} through a worn tape chain, a small melody on {NAMES[tracks[1]['inst']]}, vinyl hiss."


def r_boombap(p, g):
    tracks = [
        S("grand", C.chord_part(p, g.choice(["stabs", "push"]), 52, 79, vel=95, bass=True, bass_oct=(36, 50)), "chords", [("lofi",), ROOM]),
        S("bass", [(s, b * 0.9, C.fit(v[0], 36, 50), 105) for (s, b, _, v) in p.chords], "bass", [("lp", 1200)]),
        S("strings", C.chord_part(p, "held", 64, 86, vel=60), "pad", [("lofi",), HALL], gain=-4, release=0.6),
    ]
    return tracks, ["grand", "bass", "strings"], "A chopped-sounding piano flip with upright bass and a strings layer, crate-dug texture."


# drill


def r_drill_strings(p, g):
    lead, _ = C.lead_line(p, "drill", g, 67, 88, vel=100)
    tracks = [
        S("strings", lead, "lead", [HALL], release=0.3),
        Y("choir", C.chord_part(p, "held", 55, 76, vel=72), "pad", [BIG]),
        S("grand", C.chord_part(p, "halves", 48, 72, vel=70, strum=0.01), "chords", [("lp", 5000), HALL], gain=-3),
    ]
    return tracks, ["strings", "choir", "grand"], "A sliding violin section melody over a choir and low piano chords: dark drill."


def r_drill_piano(p, g):
    lead, _ = C.lead_line(p, "drill", g, 72, 91, vel=96)
    tracks = [
        S("grand", [(s, l, n, v) for (s, l, n, v) in lead] + [(s, l, n - 12, int(v * 0.8)) for (s, l, n, v) in lead], "lead", [("lp", 7500), HALL]),
        S("tubular", C.chord_part(p, "halves", 72, 89, vel=60, drop_top=True), "counter", [BIG], gain=-4),
        Y("darkpad", C.chord_part(p, "held", 48, 72, vel=72), "pad", [BIG], gain=-1),
    ]
    return tracks, ["grand", "tubular", "darkpad"], "An octave piano melody with bells tolling on the half notes and a dark pad."


def r_drill_pizz(p, g):
    lead, _ = C.lead_line(p, "drill", g, 67, 88, vel=100)
    tracks = [
        S("pizz", lead, "lead", [HALL]),
        S("flute", C.chord_part(p, "held", 72, 91, vel=70, drop_top=True), "pad", [BIG], gain=-6),
        S("celli", [(s, b * 0.98, C.fit(v[0], 36, 52), 90) for (s, b, _, v) in p.chords], "bass", [HALL], gain=-2, release=0.6),
        Y("choir", C.chord_part(p, "held", 55, 76, vel=65), "pad", [BIG], gain=-3),
    ]
    return tracks, ["pizz", "celli", "choir"], "Pizzicato strings carrying the melody over celli and a choir, horror-film drill."


RECIPES = {
    "trap": [r_dark_piano, r_piano_strings, r_flute, r_organ, r_kalimba, r_orchestral, r_guitar],
    "plugg": [r_plugg_bells, r_plugg_lead, r_pluggnb, r_plugg_marimba],
    "rage": [r_rage_lead, r_rage_brass, r_rage_arp],
    "phonk": [r_phonk],
    "rnb": [r_rnb_keys, r_rnb_guitar, r_rnb_harp, r_guitar],
    "soul": [r_soul, r_soul_keys],
    "lofi": [r_lofi],
    "boombap": [r_boombap],
    "drill": [r_drill_strings, r_drill_piano, r_drill_pizz, r_orchestral],
}

# Which drum pattern and 808 a full loop gets, by family.
DRUM_STYLE = {"trap": "trap", "plugg": "plugg", "rage": "rage", "phonk": "phonk", "rnb": "rnb", "soul": "soul", "lofi": "lofi", "boombap": "boombap", "drill": "drill"}
B808_STYLE = {"trap": "trap", "plugg": "plugg", "rage": "rage", "phonk": "rage", "rnb": "rnb", "drill": "drill"}

GENRE = {"trap": "Trap", "plugg": "Plugg", "rage": "Rage", "phonk": "Phonk", "rnb": "R&B", "soul": "Soul", "lofi": "Lo-fi", "boombap": "Boom bap", "drill": "Drill"}
REFERENCE = {
    "r_dark_piano": "metro boomin", "r_piano_strings": "southside", "r_flute": "wheezy", "r_organ": "metro boomin",
    "r_kalimba": "turbo", "r_orchestral": "metro boomin", "r_guitar": "taurus", "r_plugg_bells": "pi'erre bourne",
    "r_plugg_lead": "pi'erre bourne", "r_pluggnb": "summrs", "r_plugg_marimba": "stoopid xool", "r_rage_lead": "f1lthy",
    "r_rage_brass": "f1lthy", "r_rage_arp": "outtatown", "r_phonk": "dj smokey", "r_rnb_keys": "brent faiyaz", "r_rnb_guitar": "6lack",
    "r_rnb_harp": "sza", "r_soul": "j dilla", "r_soul_keys": "robert glasper", "r_lofi": "nujabes", "r_boombap": "alchemist",
    "r_drill_strings": "ax", "r_drill_piano": "808melo", "r_drill_pizz": "ghosty",
}


def family(p):
    """The loop family for a progression: its pack file, with phonk and boom bap split out by pack."""
    f = p.p["file"]
    if p.p["pack"] == "Cowbell Cathedral":
        return "phonk"
    if p.p["pack"] in ("Dust Jacket", "Cellar Sessions", "Velvet Crate"):
        return "boombap"
    if f == "neosoul":
        return "soul"
    if f == "global":
        return None
    return f


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "")).strip("-")
