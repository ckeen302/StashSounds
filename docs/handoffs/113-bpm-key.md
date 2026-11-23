# Handoff 113 BPM and key detection with file-name parsing and confidence

## Plan (written before implementation, at the top of the handoff as in 111 and 112)

Branch `lane/pipeline-113` from `origin/lane/pipeline-112` (PR #8), with `origin/phase-0/foundations`
merged (already contained at 6b7946c).

**Conflict with the spec, filed as request 113-librosa-licence.** The spec and the ticket name librosa
for onset tempo and chroma. librosa 1.0.1 requires two LGPL packages and imports both at the top of
`librosa/core/audio.py`:
- `soxr` (LGPL-2.1-or-later).
- `soundfile`, whose wheel bundles `libsndfile` (LGPL).

It also pulls `pooch`, then `requests`, then `certifi` (MPL-2.0) into the runtime. The licenses gate
refuses all three, and the rules say LGPL is never allowed (psycopg was refused for this in 111). So the
two steps librosa would have done are written on **numpy** alone (BSD-3-Clause; its wheel bundles only
OpenBLAS, BSD-3-Clause), about the same size as the "thirty lines" the spec already expects for the key
profiles. The behaviour matches the spec. Only the library differs.

The work runs in the job child, on the decoded 44.1 kHz stereo float file from 112, before it is deleted.
It is mixed to mono.

**BPM** (`audio/tempo.py`), in the spec's order of trust:
1. File name: a whole number from `limits.bpm.fileNameMin` to `fileNameMax` (60 to 200), standing alone
   or glued to `bpm`. If several qualify, the one next to `bpm` wins, then the last.
2. Duration: for 1, 2, 4, 8 and 16 bars of 4/4, `bars * 240 / seconds`, kept within
   `limits.bpm.min` to `max` and rounded to 0.01. Each candidate is scored by the onset envelope
   (below), and `bpmCandidates` lists them best first.
3. Onset: spectral flux of the log-magnitude STFT (2048 window, 512 hop), autocorrelated. A tempo's
   score is the autocorrelation at 1, 2 and 4 beat lags. The free onset tempo is the best score from
   60 to 200 BPM, rounded to a whole BPM.

The rules for choosing:
- Name present: value = name, source `filename`. `bpmAgreed` is true when the name is within 1% of the
  best duration candidate and the onset tempo is within 2% of the name. `bars` is set when the name
  fits a candidate.
- No name, onset within 2% of the best candidate: value = that candidate, source `duration`, agreed.
- No name, no agreement (not whole bars): value = onset tempo, source `onset`, not agreed, `bars` null.

**Key** (`audio/key.py`):
- `parse_key` mirrors `parseKey` in `packages/contracts/src/common.ts` character for character, with
  JavaScript's replace-first semantics and `fullmatch`. `format_key` mirrors `formatKey`.
- File-name tokens are split on separators and on digit-to-letter boundaries. Pairs ("F# minor") are
  tried before single tokens, and the last match wins.
- A lowercase token of one or two letters ("a", "am", "em", "bb") is ignored, because they are ordinary
  words in names. "Am", "A" and "dmin" are kept.
- No key in the name: chroma. Magnitude STFT (16384 window, 4096 hop), folding the bins from C2 to C7
  (65 to 2093 Hz) into the 12 pitch classes. C2 keeps a kick drum out. Each frame is normalized and the
  frames are averaged. The result is correlated with the 24 rotations of the Krumhansl-Kessler major and
  minor profiles. The best match is the key, and `keyConfidence` is its correlation minus the
  runner-up's, clamped to 0..1. A file-name key has `keyConfidence` null (nothing was measured).

**Sandbox:** the child environment gets `OPENBLAS_NUM_THREADS=1` and `OMP_NUM_THREADS=1`, so importing
numpy does not start a thread per core against RLIMIT_NPROC. This is the same trap ffmpeg hit in 112,
and the 8-task isolation test covers it.

**Tests first:**
- Parser cases mirroring the contracts test case for case, plus a test that reads the cases out of
  `packages/contracts/test/contracts.test.ts`, so the two lists cannot drift.
- File-name BPM and key token rules.
- Every loop fixture gets its manifest BPM exactly, its bars and its key, with the manifest `keySource`.
  `drill_lead_142.flac` gets G minor from chroma.
- With the file name removed, every loop fixture still gets its manifest BPM from duration and onset,
  with `bpmAgreed`.
- The trimmed duplicate (not whole bars) gets `onset`, not agreed.
- Chroma on synthetic triads in all 24 keys.

New dependency: numpy 2.5.5 (BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0; bundles OpenBLAS,
BSD-3-Clause). Reason: STFT and correlation for onset tempo and chroma.
