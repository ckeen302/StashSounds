# Fixtures

Files the worker and end-to-end tests run against. `manifest.json` lists every fixture with the
metadata the worker must produce for it (or the reason it must be rejected).

- `generated/` is synthetic, made by `python3 scripts/gen-fixtures.py`. Every value is known
  exactly: BPM, bars, key, loop length, kit categories, MIDI note counts. It also holds the
  duplicate copies and the hostile files (corrupt audio, a renamed executable, a ZIP bomb, path
  traversal, nested archives, broken MIDI and presets).
- `own/` is for the owner's real files, as ticket 006 asks: five loops, three one-shots, two
  kits, five MIDI files, three Vital presets and two Serum presets, all made by the owner.
  Add each one to `manifest.json` with its true BPM and key. Real files catch what synthetic
  ones cannot: messy names, real mixes, presets with custom wavetables.

Keep fixtures small. Anything over 5 MB should have a reason.
