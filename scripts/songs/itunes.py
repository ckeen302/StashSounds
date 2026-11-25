#!/usr/bin/env python3
"""Looks a song up on the iTunes Search API: album, release year, genre, the Apple Music link and the
600px artwork URL. Prints the top matches as JSON lines; pick the one that is the original release.

  python3 scripts/songs/itunes.py "<song>" "<artist>"
"""
import json, sys, urllib.parse, urllib.request

song, artist = sys.argv[1], sys.argv[2]
q = urllib.parse.urlencode({"term": f"{song} {artist}", "entity": "song", "limit": 8, "country": "us"})
with urllib.request.urlopen(f"https://itunes.apple.com/search?{q}", timeout=25) as r:
    res = json.load(r)["results"]
for x in res:
    print(json.dumps({
        "song": x.get("trackName"), "artist": x.get("artistName"), "album": x.get("collectionName"),
        "year": (x.get("releaseDate") or "")[:4], "genre": x.get("primaryGenreName"),
        "collectionId": x.get("collectionId"), "albumUrl": x.get("collectionViewUrl", "").split("?")[0],
        "artwork": (x.get("artworkUrl100") or "").replace("100x100bb", "600x600bb"),
    }))
if not res:
    print("no match")
