# Chord packs

Original chord-progression MIDI for the demo's MIDI tab, written in the spirit of a producer MIDI
pack: usable, voiced progressions at real tempos and keys, sorted into named packs by style. Every
progression here is written for Stash. None is copied from a commercial pack or transcribed from a record.

One JSON file per style batch. `python3 scripts/check-chord-packs.py` checks them all.

```jsonc
{
  "packs": [
    { "name": "Night Shift", "style": "trap", "description": "One sentence on the pack's sound." }
  ],
  "progressions": [
    {
      "title": "Glass Rooftop",            // original, 1-4 words, unique across all files, no artist names
      "pack": "Night Shift",               // one of this file's packs
      "bpm": 142,                          // 55..180, a tempo the style is really made at
      "key": "F# minor",                   // "<root> major" or "<root> minor", roots like C, C#, Db, F#, Bb
      "tags": ["trap", "dark", "piano"],   // 2-5 lowercase tags, the FIRST is the style
      "rhythm": "held",                    // held | roll | push | stabs | pulse | arp | bounce (see below)
      "chords": [                          // beats add up to 16 (4 bars) or 32 (8 bars)
        ["F#m9", 4, [42, 57, 61, 64, 68]], // [symbol, beats, MIDI notes low to high]; FIRST note is the bass
        ["Dmaj7/F#", 4, [42, 57, 61, 66, 69]]
      ],
      "top": [[3.5, 0.5, 73]],             // optional top-line notes [startBeat, lengthBeats, pitch]
      "description": "One or two plain sentences: the chords, the move that makes it, how to use it."
    }
  ]
}
```

Notes: bass 24..52 (usually 33..47), upper voicing 48..86 and at least 3 upper notes, the upper
voicing starts at least a fourth above the bass. Symbol and notes must agree: the bass is the root
(or the slash note), the voicing holds the right third and the right seventh when the symbol names one.

Rhythms (how the player performs the chords):
- held: the chord rings for its full length
- roll: a slow strum from bottom to top, held
- push: each chord lands an eighth early (anticipation), held
- stabs: short syncopated hits (1, the a of 1, and of 2, and of 3, e of 4) over a held bass
- pulse: repeated eighth-note chords
- arp: the upper notes broken up one at a time over a held bass
- bounce: a long hit on 1 and 3 with short pickups on the and of 2 and the and of 4
