#!/usr/bin/env python3
"""Hooktheory TheoryTab lookups for the song batches.

  python3 scripts/songs/ht.py artist <artist-slug>          list the artist's TheoryTab song slugs
  python3 scripts/songs/ht.py song <artist-slug> <song-slug>  key, tempo, meter, genre and each section's numerals
Slugs are lowercase with hyphens ("the-weeknd", "blinding-lights").
"""
import html, re, sys, urllib.request, urllib.parse

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.geturl(), r.read().decode("utf8", "replace")

def text(s):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))

cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "artist":
    a = sys.argv[2]
    url, s = get(f"https://www.hooktheory.com/theorytab/artist/{a}")
    print(url)
    for slug in sorted(set(re.findall(rf"theorytab/view/{re.escape(a)}/([a-z0-9-]+)", s))):
        print(slug)
elif cmd == "song":
    a, n = sys.argv[2], sys.argv[3]
    url = f"https://www.hooktheory.com/theorytab/view/{a}/{n}"
    try:
        url, s = get(url)
    except Exception as e:
        print(f"FAILED {url}: {e}")
        sys.exit(1)
    t = text(s)
    print("url:", url)
    m = re.search(r"Song Stats ● (.*?) Most Used", t)
    print("stats:", m.group(1) if m else "(not found)")
    m = re.search(r"All Sections (.*?) Related Music Concepts", t)
    print("sections:", m.group(1) if m else "(not found)")
    # Each section's numerals, in page order (Hooktheory's own chord-progression search links).
    seen = []
    for c in re.findall(r"chordString=([^&\"\\]+)", s):
        c = urllib.parse.unquote_plus(c)
        if c not in seen:
            seen.append(c)
    for c in seen:
        print("numerals:", c)
else:
    print(__doc__)
