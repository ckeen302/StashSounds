#!/usr/bin/env python3
"""Downloads the Apple Music artwork each batch song names (its "cover" field, copied from the iTunes
Search API) into presets/covers/ and adds it to presets/covers.json, then the sheets are repacked
with scripts/pack-demo-covers.py. Songs that already have a cover are left alone."""
import glob, json, os, re, urllib.request

root = os.path.join(os.path.dirname(__file__), "..", "..", "apps/web/src/demo")
covers_path = os.path.join(root, "presets/covers.json")
covers = json.load(open(covers_path))
added = failed = 0
for f in sorted(glob.glob(os.path.join(root, "midi/song-batches/*.json"))):
    for s in json.load(open(f)):
        c = s.get("cover")
        if not c:
            continue
        key = f"{s['song']}|{s['artist']}".lower()
        if key in covers:
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", f"{s['song']} {s['artist']}".lower().replace("#", "s")).strip("-")[:90]
        file = f"covers/{slug}.jpg"
        dest = os.path.join(root, "presets", file)
        if not os.path.exists(dest):
            try:
                req = urllib.request.Request(c["artwork"], headers={"User-Agent": "Mozilla/5.0"})
                data = urllib.request.urlopen(req, timeout=30).read()
                if len(data) < 2000 or data[:2] != b"\xff\xd8":
                    raise ValueError("not a jpeg")
                open(dest, "wb").write(data)
            except Exception as e:
                print(f"failed {key}: {e}")
                failed += 1
                continue
        covers[key] = {"file": file, "album": c["album"], "source": {"label": f"Apple Music, {c['album']} by {s['artist']}", "url": c["albumUrl"]}}
        added += 1
json.dump(covers, open(covers_path, "w"), indent=1, ensure_ascii=False)
open(covers_path, "a").write("\n")
print(f"{added} covers added, {failed} failed, {len(covers)} in covers.json")
