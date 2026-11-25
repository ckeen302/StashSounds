# Song MIDI batches

Recognizable songs as playable MIDI on the MIDI tab: each song's real chords, key and tempo (read
from a fetched source), arranged the way the record plays them: the chord rhythm, the bass movement,
voicings, and the instrument that carries the chords. Each file is one batch of about 20–25 songs,
named `<genre>-<n>.json`. `python3 scripts/check-song-batches.py` audits them all.

Chords, bass movement and groove are transcribed. Melodies are not: a `top` line may only move
between notes of the chord under it (a voicing contour), never the record's vocal or lead hook.

Tools:
- `python3 scripts/songs/indexed.py [word]` — every song already in the library (skip these)
- `python3 scripts/songs/ht.py artist <artist-slug>` — the artist's Hooktheory TheoryTab songs
- `python3 scripts/songs/ht.py song <artist-slug> <song-slug>` — key, tempo, meter, genre, each section's numerals
- `python3 scripts/songs/itunes.py "<song>" "<artist>"` — album, year, Apple Music link, 600px artwork URL

```jsonc
[
  {
    "song": "Levels",
    "artist": "Avicii",                      // as credited; "A feat. B" for features
    "producer": null,                        // or the producer's name when known
    "album": "Levels - EP",                  // from itunes.py
    "year": 2011,                            // original release year
    "genre": "edm",                          // one of the checker's GENRES
    "key": "C# minor",                       // from the source
    "bpm": 126,                              // from the source (round to the record's real tempo)
    "meter": "4/4",                          // only 4/4 songs for now
    "section": "Intro and drop (i–III–VII–VI)",
    "chordSource": { "label": "Hooktheory TheoryTab, Levels by Avicii", "url": "https://www.hooktheory.com/theorytab/view/avicii/levels" },
    "keyBpmSource": { "label": "...", "url": "https://..." },   // or null when the chord source gave key and tempo
    "timbre": "piano",                       // keys | piano | guitar | acoustic | organ | synth | pad | strings | choir | flute | pluck | bell
    "instrument": "Bright stabbed dance piano",   // what carries the chords on the record, in a few words
    "cover": { "album": "Levels - EP", "albumUrl": "https://music.apple.com/us/album/levels/1440787344",
               "artwork": "https://is1-ssl.mzstatic.com/image/thumb/.../600x600bb.jpg" },   // copied from itunes.py, or null
    "swing": 0,                              // 0 straight .. 0.6 heavy swing (pushes the off-beat 16ths)
    "chords": [                              // beats add up to 8, 16 or 32; mid-bar changes and anticipations welcome
      ["C#m", 4, [37, 56, 61, 64, 68]],      // [symbol, beats, MIDI notes low→high, bass first]
      ["E", 4, [40, 56, 59, 64, 68]],
      ["B", 4, [35, 54, 59, 63, 66]],
      ["A", 4, [33, 57, 61, 64, 69]]
    ],
    "hits": [[0, 0.5], [0.75, 0.5], [1.5, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]],  // the chord strike pattern for one bar, repeated every bar
    "rhythm": "stabs",                       // used only when "hits" is left out (held|roll|push|stabs|pulse|arp|bounce)
    "bass": [[0, 0.75, 0], [0.75, 0.75, 0], [1.5, 1, 12], [2.5, 1.5, 0]],         // bass strikes for one bar: [start, length, octave -12|0|12]
    "top": [[0, 2, 68], [2, 2, 64]],         // optional chord-tone contour [start, length, pitch]
    "notes": "Chords and key from Hooktheory; one bar per chord as on the record; piano stab rhythm by ear."
  }
]
```

Every strike plays whichever chord is sounding at that moment, so a one-bar pattern follows mid-bar
chord changes. A held block chord over a held bass is rejected: give the chords or the bass (or both)
the record's rhythm.
