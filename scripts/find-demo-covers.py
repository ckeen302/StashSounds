#!/usr/bin/env python3
"""Finds album covers for the demo's songs on the iTunes Search API and adds them to presets/covers.json.

  node scripts/demo-cover-gaps.mjs --queue /tmp/queue.json     # the songs still without a cover
  python3 scripts/find-demo-covers.py /tmp/queue.json [--max-new N] [--max-calls N] [--pace S] [--dry]
  python3 scripts/pack-demo-covers.py                          # then repack the sheets

The Search API allows about 20 calls a minute from one address (and answers 403 past that), so the
songs are looked up by artist: one artist search, then the artist's songs and albums (two lookups of
up to 200 each) answer every queued song by that artist. MIDI songs the artist's lists
miss get a search of their own. The pace slows on every 403 and recovers slowly; answers are cached
in ~/.cache/stash-demo-covers.json, so a stopped run picks up where it was.

A result is kept only when it is clearly the same recording:
  - the track title matches (feat. credits, "Remastered", "Album Version" and the like ignored; a
    remix, live take, instrumental, sped-up or re-recorded version never stands in for the song),
  - the credited artist is the song's lead artist (or one of the names on a shared credit),
  - nothing about it says karaoke, tribute, "made famous by", "in the style of", lullaby, 8-bit, ...
Among matches it prefers the album the demo already names, then the artist's own album over a single,
then over the artist's own best-of; a various-artists compilation is never used, nor a release from
before the song's year. With a known year, a much later best-of is dropped as unsure. Failing a track
match, the album the demo names is looked for among the artist's albums. When in doubt the song stays
without art (the page shows a fallback tile in the theme's colors) and goes in presets/cover-misses.json,
so later runs skip it.

Artwork is saved at the sprite-sheet tile size (240 px) in presets/covers/. Presets and MIDI songs go in
presets/covers.json with the album and the Apple Music link as their source, like the rows that were
there before; Samples-tab songs and sampled records go in samples/covers.json, a compact row
({f: file, a: album, by: Apple's artist credit, u: Apple Music link}) that loads only with that tab.
"""
import json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
from io import BytesIO
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps/web/src/demo/presets")
COVERS = os.path.join(ROOT, "covers.json")
LAZY = os.path.join(ROOT, "..", "samples", "covers.json")  # the Samples tab's own, loaded with it
MISSES = os.path.join(ROOT, "cover-misses.json")
DIR = os.path.join(ROOT, "covers")
TILE = 240
UA = {"User-Agent": "demo-cover-finder/1.0"}

BAD = re.compile(
    r"karaoke|tribute|made famous|in the style of|originally performed|as performed by|cover version|"
    r"lullab|8[- ]?bit|string quartet|vitamin string|rockabye|piano version|piano tribute|workout|kidz bop|"
    r"sped ?up|slowed|nightcore|re-?recorded|backing track|instrumental version|ringtone|"
    r"\bmidi\b|music box|reggae version|bossa nova version|jazz version|acapella|a cappella",
    re.I,
)
# A version that is not the song unless the song itself says so.
VERSION = re.compile(r"remix|\bmix\b|\blive\b|acoustic|instrumental|demo|reprise|edit\b|rework|refix|bootleg|dub\b|version|skit|interlude|chopped|screwed", re.I)
NOISE = re.compile(
    r"\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]"
    r"|\s*[\(\[][^\)\]]*(?:remaster|album version|single version|explicit|clean|lp version|original mix|from [^\)\]]*soundtrack|bonus track)[^\)\]]*[\)\]]"
    r"|\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|single version|album version|lp version|mono|stereo)\b.*$"
    r"|\s+(?:feat\.?|ft\.?|featuring)\s.*$",
    re.I,
)
COMPILATION = re.compile(r"greatest hits|best of|\bcollection\b|essential|anthology|\bhits\b|\bgold\b|ultimate|very best|platinum|definitive|classics|20th century masters|the singles|retrospective|playlist|number ones|#1s|love songs|soundtrack|motion picture|music from", re.I)
SPLIT = r",\s*|\s+&\s+|\s+x\s+|\s+(?:feat\.?|ft\.?|featuring|with|and)\s+"
ALBUM_NOISE = r"\(.*?\)|\[.*?\]|deluxe|edition|expanded|remaster(ed)?|anniversary|version|\s-\s(single|ep)$"


def flat(x: str) -> str:
    x = unicodedata.normalize("NFKD", x).encode("ascii", "ignore").decode().lower()
    x = x.replace("&", " and ").replace("$", "s")
    x = re.sub(r"^the\s+", "", x.strip())
    return re.sub(r"[^a-z0-9]", "", x)


def base_title(t: str):
    """The title without credits and remaster noise, and the parenthetical parts that remain."""
    t = NOISE.sub("", t).strip()
    parts = re.findall(r"[\(\[]([^\)\]]*)[\)\]]", t)
    return flat(t), flat(re.sub(r"\s*[\(\[][^\)\]]*[\)\]]", "", t)), parts


def title_match(ours: str, theirs: str) -> bool:
    o_full, o_base, o_parts = base_title(ours)
    t_full, t_base, t_parts = base_title(theirs)
    # "Paper (Remix)" never matches "Paper", and "Paper" never matches "Paper (Live)".
    o_ver = any(VERSION.search(p) for p in o_parts) or bool(re.search(r"\bremix\b", ours, re.I))
    t_ver = any(VERSION.search(p) for p in t_parts) or bool(re.search(r"\s-\s.*(remix|live|mix|edit|version|acoustic|instrumental)", theirs, re.I))
    if o_ver != t_ver:
        return False
    if o_full and o_full == t_full:
        return True
    return bool(o_base) and o_base == t_base and not o_ver and not t_ver


def lead_credit(artist: str) -> str:
    return re.split(r"\s+(?:feat\.?|ft\.?|featuring|with)\s+", artist, flags=re.I)[0].strip()


def leads(artist: str):
    """The names that would credit the song's lead artist: the whole credit, then its first name."""
    a = lead_credit(artist)
    out = [flat(a)]
    first = re.split(r",\s*|\s+&\s+|\s+x\s+|\s+and\s+", a, flags=re.I)[0]
    if flat(first) != out[0]:
        out.append(flat(first))
    return [x for x in out if len(x) >= 2]


def artist_match(ours: str, theirs: str) -> bool:
    """The song's lead artist is the credited artist, or one of the names in a shared credit."""
    names = {flat(theirs)} | {flat(n) for n in re.split(SPLIT, theirs, flags=re.I)}
    return any(l in names for l in leads(ours))


def strip_album(name: str) -> str:
    return flat(re.sub(ALBUM_NOISE, "", name, flags=re.I))


def choose(row, results):
    year = row.get("year")
    album = strip_album(row["album"]) if row.get("album") else ""
    best, best_score = None, None
    for x in results:
        if x.get("wrapperType") != "track" or x.get("kind") != "song":
            continue
        name, art, coll = x.get("trackName", ""), x.get("artistName", ""), x.get("collectionName", "")
        if BAD.search(f"{name} {art} {coll}") and not BAD.search(row["song"] + " " + row["artist"]):
            continue
        if not title_match(row["song"], name) or not artist_match(row["artist"], art):
            continue
        ca = x.get("collectionArtistName") or ""
        if re.search(r"various", ca, re.I):
            continue
        if ca and not artist_match(row["artist"], ca) and not artist_match(ca, art):
            continue
        ry = int((x.get("releaseDate") or "0")[:4] or 0)
        own_album = bool(album) and strip_album(coll) == album
        comp = bool(COMPILATION.search(coll)) and not own_album
        single = bool(re.search(r"\s-\s(single|ep)$", coll, re.I))
        score = -6.0 if own_album else 0.0
        score += 3 if comp else 0
        score += 1 if single else 0
        if year and ry:
            d = ry - year
            if d < -1:  # out before the song was: a different song of the same name
                continue
            score += min(abs(d), 10) * 0.4
            if d > 3 and not own_album:
                score += 2  # a later reissue or best-of: a last resort
        elif ry:
            score += (ry - 1950) * 0.01  # earliest release first
        if best_score is None or score < best_score:
            best, best_score = x, score
    if best is None:
        return None
    if year and best.get("releaseDate") and row.get("tab") != "originals":
        # Unsure: nothing but a much later release from a best-of, for a song whose album is unknown.
        if int(best["releaseDate"][:4]) - year > 3 and COMPILATION.search(best.get("collectionName", "")) and not row.get("album"):
            return None
    return best


def album_hit(row, albums):
    """The song's own album (the demo names it) among the artist's albums on iTunes."""
    if not row.get("album"):
        return None
    want = strip_album(row["album"])
    if len(want) < 2:
        return None
    found = [a for a in albums if a.get("wrapperType") == "collection" and strip_album(a.get("collectionName", "")) == want and not BAD.search(a.get("collectionName", ""))]
    if row.get("year"):
        found = [a for a in found if int((a.get("releaseDate") or "0")[:4] or 0) >= row["year"] - 1]
    # The plain edition first, then the earliest.
    found.sort(key=lambda a: (bool(re.search(r"deluxe|expanded|anniversary", a.get("collectionName", ""), re.I)), a.get("releaseDate") or ""))
    return found[0] if found else None


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s)).strip("-")[:90]


class Api:
    """The iTunes Search API, paced: a pause and a slower pace after every 403, a little faster after every 10 answers."""

    def __init__(self, pace: float):
        self.pace, self.floor, self.last, self.calls, self.refused = pace, pace, 0.0, 0, 0

    def json(self, path: str, **params):
        url = f"https://itunes.apple.com/{path}?{urllib.parse.urlencode(params)}"
        for attempt in range(12):
            wait = self.pace - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                    self.calls += 1
                    if self.calls % 10 == 0:
                        self.pace = max(self.floor, self.pace - 0.25)
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                if e.code in (403, 429) or e.code >= 500:
                    self.refused += 1
                    self.pace = min(8.0, self.pace + 0.5)
                    back = min(240, 30 * (attempt + 1))
                    print(f"  HTTP {e.code}: waiting {back}s, then one call every {self.pace:.1f}s", file=sys.stderr, flush=True)
                    time.sleep(back)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                print(f"  {e}, retrying", file=sys.stderr, flush=True)
                time.sleep(10 * (attempt + 1))
        raise RuntimeError(f"gave up on {url}")


def fetch_art(url: str) -> Image.Image:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        im = Image.open(BytesIO(r.read())).convert("RGB")
    side = min(im.size)
    im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2))
    return im.resize((TILE, TILE), Image.LANCZOS)


def main():
    args = sys.argv[1:]
    queue = json.load(open(args[0]))

    def opt(name, d):
        return type(d)(args[args.index(name) + 1]) if name in args else d

    max_new, max_calls, pace = opt("--max-new", 10**9), opt("--max-calls", 10**9), opt("--pace", 3.5)
    dry = "--dry" in args
    cache_path = opt("--cache", os.path.join(os.path.expanduser("~"), ".cache", "stash-demo-covers.json"))
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    for k in ("artists", "songs", "albums"):
        cache.setdefault(k, {})
    covers = json.load(open(COVERS))
    lazy = json.load(open(LAZY)) if os.path.exists(LAZY) else {}
    misses = json.load(open(MISSES)) if os.path.exists(MISSES) else {}
    files = set(os.listdir(DIR))
    by_art, added, done = {}, 0, 0
    api = Api(pace)

    def save():
        json.dump(cache, open(cache_path, "w"))
        if dry:
            return
        open(COVERS, "w").write(json.dumps(covers, indent=1, ensure_ascii=False) + "\n")
        open(LAZY, "w").write("{\n" + ",\n".join(f"{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}" for k, v in lazy.items()) + "\n}\n")
        open(MISSES, "w").write(json.dumps(misses, indent=0, sort_keys=True, ensure_ascii=False) + "\n")

    def artist_id(credit: str):
        """The iTunes artist for a credit: the whole name, else its first name, matched exactly."""
        names = [credit] + [n for n in re.split(SPLIT, credit, flags=re.I)[:1] if flat(n) != flat(credit)]
        for name in names:
            k = flat(name)
            if not k:
                continue
            if k not in cache["artists"]:
                res = api.json("search", term=name, entity="musicArtist", limit=10, country="us")["results"]
                ids = [r["artistId"] for r in res if flat(r.get("artistName", "")) == k]
                cache["artists"][k] = ids[0] if ids else None
            if cache["artists"][k]:
                return cache["artists"][k]
        return None

    def lookup(kind: str, aid: int):
        k = str(aid)
        if k not in cache[kind]:
            res = api.json("lookup", id=aid, entity="song" if kind == "songs" else "album", limit=200, country="us")["results"]
            keep = ("trackName", "artistName", "collectionName", "collectionArtistName", "releaseDate", "artworkUrl100", "collectionViewUrl", "wrapperType", "kind")
            cache[kind][k] = [{f: r[f] for f in keep if f in r} for r in res[1:]]
        return cache[kind][k]

    # The queue's songs by lead artist, in the order the artists first come up.
    groups: dict = {}
    for row in queue:
        key = f"{row['song']}|{row['artist']}".lower()
        if key in covers or key in lazy or key in misses:
            continue
        groups.setdefault(flat(lead_credit(row["artist"])), []).append(row)
    print(f"{sum(map(len, groups.values()))} songs by {len(groups)} artists to look up", file=sys.stderr, flush=True)
    for n, rows in enumerate(groups.values()):
        if added >= max_new or api.calls >= max_calls:
            break
        try:
            aid = artist_id(lead_credit(rows[0]["artist"]))
            songs = lookup("songs", aid) if aid else []
            # The album list only helps songs the song list misses and whose album the demo names.
            need = aid and any(r.get("album") and not choose(r, songs) for r in rows)
            albums = lookup("albums", aid) if need else []
        except Exception as e:  # noqa: BLE001 - one bad artist never stops the run
            print(f"  lookup failed for {rows[0]['artist']}: {e}", file=sys.stderr, flush=True)
            continue
        for row in rows:
            key = f"{row['song']}|{row['artist']}".lower()
            hit = choose(row, songs) or album_hit(row, albums)
            if hit is None and row.get("tab") == "midi":
                # MIDI song charts get a search for the song itself too. (The preset songs still
                # missing were searched song by song when their covers were first found.)
                title = re.sub(r"[\(\[].*?[\)\]]", "", row["song"]).strip() or row["song"]
                try:
                    res = api.json("search", term=f"{title} {lead_credit(row['artist'])}", entity="song", limit=25, country="us")["results"]
                except Exception as e:  # noqa: BLE001
                    print(f"  search failed for {key}: {e}", file=sys.stderr, flush=True)
                    continue
                hit = choose(row, res)
            done += 1
            print(json.dumps({"q": key, "tab": row.get("tab"), "year": row.get("year"), "album": row.get("album"), "hit": hit and [hit.get("trackName"), hit.get("artistName"), hit.get("collectionName"), (hit.get("releaseDate") or "")[:4]]}, ensure_ascii=False), flush=True)
            if dry:
                continue
            if hit is None:
                misses[key] = {"tab": row.get("tab"), "checked": time.strftime("%Y-%m-%d")}
                continue
            art = (hit.get("artworkUrl100") or "").replace("100x100bb", "600x600bb")
            if not art:
                continue
            fname = by_art.get(art)
            if not fname:
                name = slug(f"{row['song']} {row['artist']}") or "cover"
                fname, i = f"{name}.jpg", 2
                while fname in files:
                    fname, i = f"{name}-{i}.jpg", i + 1
                try:
                    fetch_art(art).save(os.path.join(DIR, fname), quality=86, optimize=True, progressive=True)
                except Exception as e:  # noqa: BLE001
                    print(f"  artwork failed for {key}: {e}", file=sys.stderr, flush=True)
                    continue
                files.add(fname)
                by_art[art] = fname
                added += 1
            coll = hit.get("collectionName", "")
            url = hit.get("collectionViewUrl", "").split("?")[0]
            if row.get("tab") in ("samples", "originals"):
                # The Samples tab's covers load with that tab: a compact row (cover.tsx registerCovers).
                lazy[key] = {"f": fname, "a": coll, "by": hit.get("artistName", ""), "u": url}
            else:
                covers[key] = {"file": f"covers/{fname}", "album": coll, "source": {"label": f"Apple Music, {coll} by {hit.get('artistName', '')}", "url": url}}
        save()  # after every artist: a stopped run loses nothing
        if n % 10 == 0:
            print(f"[{n + 1}/{len(groups)} artists] {done} songs checked, {added} new cover files, {api.calls} calls, {api.refused} refused", file=sys.stderr, flush=True)
    save()
    print(f"done: {done} songs checked, {added} new cover files, {api.calls} calls, {len(misses)} misses recorded", file=sys.stderr)


if __name__ == "__main__":
    main()
