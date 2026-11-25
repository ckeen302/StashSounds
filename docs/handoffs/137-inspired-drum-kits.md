# Handoff 137 (add-on) "Inspired by" drum kits on the Drums tab

Asked for by Caden: drum sounds tied to Pi'erre Bourne, F1lthy, Metro Boomin and similar producers.

## What is in it
- Six original kits on the Drums tab, 107 sounds, each named "<kit> (inspired by <producer>)":
  Pink Sky (Pi'erre Bourne), Red Room (F1lthy), Midnight Score (Metro Boomin), Bounce Theory
  (Wheezy), Basement (Southside), Memphis Bounce (Tay Keith). Owner @stash. Each description says
  the sounds are Stash originals, not the producer's samples, and not made or endorsed by them.
- `scripts/build-demo-kits.py` + `scripts/kits/drums.py`: every hit synthesized from oscillators and
  noise (reuses `scripts/sfx/dsp.py`). Writes `apps/web/src/demo/kits/media/<kit>.mp3` (one sprite per
  kit, 160 kbps, peaks kept under 0 dBFS after decoding) and `apps/web/src/demo/kits/library.json`.
- `kits/store.ts`: `KitSound.clip` (a slice of a sprite), `clipBuffer()`, `play()` handles clips.
  `oneshots/store.ts`: `bufferOf()` handles clips, so the 808s/Kicks/... lists, waveforms and wav
  downloads work. `kits/pages.tsx`: search also matches names without apostrophes ("pierre").
- `scripts/build-demo-app.mjs` copies `kits/media` to `out-demo/demo/kits/`.
- Layout unchanged.

## Why no real kits are hosted
Research found no official free kit from any of these producers that allows re-hosting. Official
kits (F1lthy x Lukrative Vol II/III and F1lthy x GAB3 Raver Kit on Splice via Traktrain; Southside
"I Invented Trap" and "King of Trap Vol. 1" on Splice; Murda Beatz Quarantine and Bandemic on Splice;
Nick Mira kits on WavSupply; Zaytoven's 2016 Splice pack) are licensed for use in your own music
only. Pi'erre Bourne, Metro Boomin, Wheezy, Tay Keith and ATL Jacob have no verified official kit;
the free "official" downloads under their names are type kits or leaks.

## Checks
```
pnpm --filter @stash/web exec tsc --noEmit -p .   -> exit 0
pnpm exec eslint apps/web/src/demo/kits apps/web/src/demo/oneshots   -> exit 0
pnpm --filter @stash/web exec vitest run src/demo   -> 5 files, 19 tests passed
```
Playwright smoke on the built demo: Drums tab lists the six kits, a kit page opens, a sound plays
(sprite fetched 200, no console errors), a single-sound download is a 2.4 s 44.1 kHz stereo wav.
New dependency: none shipped (scipy for the build script, BSD-3-Clause, already used by the SFX build).
