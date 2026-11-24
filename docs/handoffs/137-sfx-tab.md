# Handoff 137 (add-on) SFX tab in the browser demo

Asked for by Caden: a deep sound-effects library as its own tab, browsed like a big stock-sound
site (category, then subcategory, then rows), with play, a waveform and Download on every row.
Examples he gave: lion and tiger roars (producer tags), voicemail audio, Lambo revs, a car starting,
alarms, sirens, a train passing, a guy yelling, gibberish.

## What is in it
- `apps/web/src/demo/sfx/page.tsx`: the tab at `/sfx` (`#sfx`). Search, 12 category tiles with
  counts, subcategory chips, sort (featured, shortest, longest), and rows with play, subcategory,
  source and license, two tags, a waveform that lights as it plays (tap it to jump), length, a
  Source link for recordings, and Download. "Grab all" zips a subcategory (up to 40). Keyboard:
  arrows move and play, Space replays, D downloads. Long lists page by 60.
- `apps/web/src/demo/sfx/library.ts`: the data, a small player (one shared AudioContext from
  `kits/store`, pauses the loop engine and the MIDI synth first) and the download (the slice cut
  from its sprite as a 44.1 kHz wav, plus a LICENSE.txt naming source, author and license).
- `apps/web/src/demo/sfx/library.json` and `apps/web/src/demo/sfx/media/*.mp3`: generated, committed.
  One mp3 per subcategory (a sprite) keeps the artifact's file count low.
- `scripts/build-demo-sfx.py` (lead-owned script) builds both; `scripts/sfx/dsp.py` and
  `scripts/sfx/recipes.py` synthesize the originals; `scripts/sfx/recordings.json` lists the
  recordings.
- Shared files touched, each a line or two: `main.tsx` (import, route, tab, home card; the home
  type grid goes to six columns on desktop), `demo.css` (three waveform rules at the end),
  `scripts/build-demo-app.mjs` (copies `sfx/media` to `out-demo/demo/sfx/`).

## Where the sounds come from
Nothing is ripped from songs, films or games, and nothing is taken from Epidemic Sound or any
other library. Two sources only:
1. Stash originals, synthesized from scratch in `recipes.py` (oscillators, noise, filters, a small
   engine model, a formant voice for gibberish). Released as CC0.
2. Recordings from Wikimedia Commons whose page carries a public-domain or CC0 template
   (PD-self, PD-author, PD-USGov including National Park Service and Fish and Wildlife Service,
   Cc-zero). Each entry keeps the file name, page URL, author and license. Files with any CC-BY,
   GFDL or non-free template were left out, as were stock sounds of murky origin (the Wilhelm
   scream) and game assets.

## Rebuild
```
python3 scripts/build-demo-sfx.py      # needs numpy, scipy, ffmpeg; recordings cached in .local/sfx-cache
node scripts/build-demo-app.mjs
```
New dependency (build script only, not shipped): scipy, BSD-3-Clause, for filters and convolution.

## Known limits
- Wikimedia rate-limits the cloud machine's shared address, so recordings download a few at a
  time; `build-demo-sfx.py` skips (and prints) any it could not fetch. Commons is also thin on cars
  and big cats. A free Freesound API key (freesound.org and cdn.freesound.org allowed) would open
  thousands of CC0 recordings of exactly those.
- Synthesized engines, gibberish and yells are convincing as effects, not as field recordings.
