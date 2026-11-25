#!/usr/bin/env python3
"""Turns the sample credits read from Wikipedia album articles into apps/web/src/demo/samples/samples.json.

Input: a JSON list of albums, each [page, album, artist, year, songs], where a song is
[title, producers, samples] and a sample is [title, performer, year, genre, isSample, page].
It was read from each album article's "Sample credits" section (the album's liner notes) through
the Wikipedia API, with the sampled record's year and genre from its own article or its artist's.
Nothing here comes from WhoSampled.

Usage: python3 scripts/samples/build-samples.py scripts/samples/wikipedia-sample-credits.json
"""
import json, re, sys, os
from urllib.parse import quote

raw = json.load(open(sys.argv[1]))
out_path = os.path.join(os.path.dirname(__file__), "../../apps/web/src/demo/samples/samples.json")

RULES = [
    (r"jazz rap|hip.?hop|rap\b|trap|drill|crunk|g-funk|boom bap|grime|memphis|bounce|horrorcore", "Hip-hop"),
    (r"soul jazz|jazz|bop|fusion|big band|swing", "Jazz"),
    (r"gospel|christian|spiritual", "Gospel"),
    (r"funk|disco|boogie|go-go", "Funk"),
    (r"r&b|rhythm and blues|doo-wop|new jack|quiet storm|motown", "R&B"),
    (r"soul", "Soul"),
    (r"blues", "Blues"),
    (r"reggae|ska|dancehall|dub\b|rocksteady|lovers rock", "Reggae"),
    (r"house|techno|electro|downtempo|trip|dubstep|ambient|chillwave|edm|dance|idm|synthwave|vaporwave|jungle|drum and bass|breakbeat|garage", "Electronic"),
    (r"metal|rock|punk|grunge|psychedel|shoegaze|emo\b|post-", "Rock"),
    (r"folk|singer-songwriter|americana", "Folk"),
    (r"country|bluegrass", "Country"),
    (r"latin|bossa|mpb|samba|cumbia|salsa|bolero|balada|tejano|tropicália|tango|reggaeton|bolly|filmi", "Latin"),
    (r"afro|makossa|zamrock|highlife|juju|ethio|world|k-pop|j-pop|city pop|enka|chanson|kayōkyoku", "World"),
    (r"score|soundtrack|library|television|film|theme|musical|cinematic|incidental", "Soundtrack"),
    (r"classical|opera|chamber|orchestral|baroque|romantic|minimal|contemporary classical", "Classical"),
    (r"pop|new wave|indie|adult contemporary|easy listening|exotica|lounge|vocal|crooner|standards|novelty|comedy", "Pop"),
]
def bucket(g):
    if not g: return "Other"
    g = g.lower()
    for rx, name in RULES:
        if re.search(rx, g): return name
    return "Other"

def clean_name(s):
    s = re.sub(r"<ref.*$|<!--.*$", "", s or "").strip()
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    if not re.search(r"(?:\b[A-Z]\.){2,}$", s): s = re.sub(r"\.$", "", s)
    s = re.sub(r"^the ", "The ", s)
    return s.strip(" ,;")

def producers(p):
    p = p or ""
    m = re.search(r"\{\{\s*(?:hlist|flatlist|flat list)\s*\|([^{}]*)\}?\}?", p, re.I)
    if m: p = m.group(1).replace("|", ", ")
    if "{{" in p: return []
    names = []
    for n in re.split(r",| and | & ", p):
        n = n.strip()
        if n and n not in names and len(n) > 1: names.append(n)
    return names

SAFE = "()_,!'"
wiki = lambda page: "https://en.wikipedia.org/wiki/" + quote(page.replace(" ", "_"), safe=SAFE)
lead = lambda a: re.split(r" and | & |,| featuring | feat\. ", a)[0].lower().strip()
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())

songs, dropped = [], 0
for page, album, artist, year, tracks in raw:
    # Soundtracks and compilations credit no one artist; their songs are left out.
    if not artist or re.match(r"(?i)various", artist): continue
    artist = re.sub(r"^the ", "The ", artist)
    artist = artist.replace("Joey Badass", "Joey Bada$$").replace("ASAP Rocky", "A$AP Rocky").replace("Juice Wrld", "Juice WRLD")
    for title, prod, samples in tracks:
        title = re.sub(r"\{\{'\}\}|\{\{.*$", "", title).strip()
        if not title or "{{" in title: continue
        uses = []
        for s_title, perf, oyear, genre, is_sample, opage in samples:
            perf = clean_name(perf)
            # The liner notes sometimes give a surname only for an artist already named in full.
            perf = {"West": "Kanye West", "Ye": "Kanye West", "Jay": "Jay-Z"}.get(perf, perf)
            s_title = re.sub(r"\s+", " ", s_title).strip()
            if not perf or len(perf) < 2 or "[" in perf or "{" in perf or perf.lower().endswith((" the", " and")):
                dropped += 1; continue
            # A song listed as sampling itself (a remix or an earlier version) is not a sample.
            if norm(s_title) == norm(title) and (lead(perf) in artist.lower() or lead(artist) in perf.lower()):
                dropped += 1; continue
            if any(norm(u["title"]) == norm(s_title) and norm(u["artist"]) == norm(perf) for u in uses): continue
            if oyear and year and oyear > year: oyear = None
            uses.append({"title": s_title, "artist": perf, "year": oyear, "genre": bucket(genre),
                         "type": "sample" if is_sample else "interpolation", 
                         "page": wiki(opage) if opage else None})
        if not uses: continue
        songs.append({"song": title, "artist": artist, "year": year, "album": album, "producers": producers(prod),
                      "samples": uses, "sources": [{"label": f"Wikipedia: {album}, sample credits", "url": wiki(page)}]})

# Compact rows (the file ships inside the demo bundle):
# [song, artist, year, album, producers, album article, [[title, artist, year, genre, replayed, article]]]
WIKI = "https://en.wikipedia.org/wiki/"
rows = [[x["song"], x["artist"], x["year"], x["album"], x["producers"], x["sources"][0]["url"].removeprefix(WIKI),
         [[u["title"], u["artist"], u["year"], u["genre"], 0 if u["type"] == "sample" else 1, (u["page"] or "").removeprefix(WIKI)] for u in x["samples"]]]
        for x in songs]
json.dump(rows, open(out_path, "w"), ensure_ascii=False, separators=(",", ":"))
from collections import Counter
print(len(songs), "songs,", sum(len(x["samples"]) for x in songs), "samples,", dropped, "dropped")
