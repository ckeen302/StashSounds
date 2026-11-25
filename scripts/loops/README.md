# Loop library (demo)

`python3 scripts/loops/build.py` renders the Loops tab's library: 136 melodic and full-beat loops
built on the demo's own chord packs, plus 16 drum loops. It writes committed previews to
`apps/web/src/demo/loop-library/media/` and the catalog to `apps/web/src/demo/loop-library/loops.json`.

- `fetch-instruments.sh` fetches the sampled instruments: VCSL and VSCO 2 CE, both CC0 1.0 (public
  domain), so the rendered loops can be redistributed royalty free. Synths, 808s and drums are
  synthesized in `instruments.py`; nothing is sampled from a commercial pack or a record.
- `compose.py` writes the parts (voicings from the pack, hooks, arps, 808 lines, drum patterns),
  `catalog.py` holds the 25 arrangements, `render.py` mixes each part to a level for its role and
  renders the loop twice, keeping the second pass so tails wrap and the loop is seamless.
- Tempo and key come from the progression; `build.py` checks the key against the written notes and
  the audio, and checks each loop's seam, printing anything that fails.
- Python deps: numpy, scipy (BSD), soundfile (BSD), plus ffmpeg. `check-tuning.py` re-measures
  each instrument's pitch against its file names.
