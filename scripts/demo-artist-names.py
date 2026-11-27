#!/usr/bin/env python3
"""Finds artists the demo's libraries spell more than one way and writes the one spelling to use.

Reads every artist credit in the Presets rows (found.json and the hand rows in data.ts), the Samples
catalog (songs and the records they sample) and the song chords, splits credits into names, and
groups names that are the same once case, accents, punctuation, "$" for "s" and a leading "The" are
set aside ("JAY Z", "Jay-Z", "JAŸ-Z"; "A$AP Rocky", "ASAP Rocky"). Each group takes its most used
spelling unless PREFER names the artist's own; a few groups are different artists that only look
alike and are left apart (SEPARATE).

Writes apps/web/src/demo/artist-names.json: {variant: spelling}, only for names that change.
Usage: python3 scripts/demo-artist-names.py
"""
import collections, glob, json, os, re, unicodedata

ROOT = os.path.join(os.path.dirname(__file__), "..")
D = os.path.join(ROOT, "apps/web/src/demo/")

# The artist's own spelling, where the most used one here is not it.
PREFER = {
    "rundmc": "Run-DMC",
    "outkast": "OutKast",
    "tooshort": "Too $hort",
    "tydollasign": "Ty Dolla $ign",
    "mfdoom": "MF DOOM",
    "partynextdoor": "PARTYNEXTDOOR",
    "mase": "Mase",
    "asapmob": "A$AP Mob",
    "6lack": "6LACK",
    "kidlaroi": "The Kid LAROI",
    "lox": "The LOX",
    "originalbroadwaycastofhamilton": "Original Broadway Cast of Hamilton",
}
# Different acts that fold to the same key: The Prodigy (UK) and Prodigy (Mobb Deep); M.I.A. and Mia.
SEPARATE = {"prodigy", "mia"}


def fold(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("$", "s").replace("&", "and")
    s = re.sub(r"^the ", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


SEP = re.compile(r"\s+(?:feat\.?|featuring|ft\.?|with|x|and|&)\s+|,\s*", re.I)
count = collections.Counter()


def add(credit):
    for n in SEP.split(credit or ""):
        n = n.strip()
        if n:
            count[n] += 1


for r in json.load(open(D + "presets/found.json")):
    add(r["artist"])
for m in re.finditer(r'artist: "([^"]+)"', open(D + "presets/data.ts").read()):
    add(m.group(1))
for r in json.load(open(D + "samples/samples.json")):
    add(r[1])
    for u in r[6]:
        add(u[1])
for r in json.load(open(D + "midi/song-chords.json")):
    add(r["artist"])
for f in glob.glob(D + "midi/song-batches/*.json"):
    for r in json.load(open(f)):
        if isinstance(r, dict) and "artist" in r:
            add(r["artist"])

groups = collections.defaultdict(list)
for n, c in count.items():
    k = fold(n)
    if k and k not in SEPARATE:
        groups[k].append((c, n))

out = {}
for k, names in groups.items():
    if len(names) < 2:
        continue
    spellings = {n for _, n in names}
    # "the Creator" / "The Creator": the tail of "Tyler, the Creator" or "Sly & the Family Stone" split
    # at its comma or ampersand, not a second spelling.
    if all(re.match(r"(?i)^the ", n) for n in spellings) and len({n[4:] for n in spellings}) == 1:
        continue
    # "Dream" / "The Dream", "Game" / "The Game": one word apart from "The" can be two acts, or the
    # tail of a split credit. Leave those as they are.
    bare = {re.sub(r"(?i)^the ", "", n) for n in spellings}
    if any(re.match(r"(?i)^the ", n) for n in spellings) and len(bare) == 1 and " " not in next(iter(bare)):
        continue
    best = PREFER.get(k) or max(names, key=lambda cn: (cn[0], -sum(ch in ".:)(" for ch in cn[1])))[1]
    # Never pick a spelling with stray punctuation from a scraped credit ("Juvenile)", "Playboi Carti.").
    if re.search(r"[)(:]$|\.$", best) and not re.search(r"\b[A-Z]\.$", best):
        clean = [n for c, n in sorted(names, reverse=True) if not re.search(r"[)(:]$|[a-z]\.$", n)]
        best = clean[0] if clean else best
    # A lowercase "the X" is the tail of a split credit ("DJ Jazzy Jeff & the Fresh Prince"), never a name.
    if best.startswith("the "):
        continue
    for _, n in names:
        if n != best:
            out[n] = best

with open(D + "artist-names.json", "w") as fh:
    json.dump(dict(sorted(out.items())), fh, ensure_ascii=False, indent=0)
print(f"{len(out)} spellings fold into {len({v for v in out.values()})} names")
