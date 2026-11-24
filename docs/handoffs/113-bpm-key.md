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

## What changed
All of it is under `apps/worker/`.
- `audio/key.py` (new):
  - `parse_key` and `format_key` mirror the contracts.
  - `key_from_name` reads the key from the file-name tokens.
  - `pitch_chroma` folds C2 to C7 into 12 pitch classes, in blocks.
  - `key_from_chroma` matches 24 Krumhansl-Kessler rotations and returns the margin as confidence.
  - `detect_key` puts these together.
- `audio/tempo.py` (new): `bpm_from_name`, `duration_candidates`, the spectral-flux `onset_envelope`
  (in blocks), autocorrelation scoring at 1, 2 and 4 beats, `onset_tempo` from 60 to 200, and
  `detect_bpm`, which applies the rules in the plan.
- `audio/loop.py`: after the peaks, the decoded file is read as mono. BPM and key come from it and from
  the original row's `fileName`, before the file is deleted. The result now carries `bpm`, `key`,
  `bars` and the full `detection` record. `worker_complete` copies `bpm`, `key_root` and `key_mode` to
  the item unless the uploader set them.
- `sandbox.py`: the child gets `OPENBLAS_NUM_THREADS=1` and `OMP_NUM_THREADS=1`. Without them, importing
  numpy here started 4 threads, one per core. With them it starts 1.
- Tests: `test_detection.py` (new, 100 cases), the loop-fixture assertions in `test_audio.py`, the
  real-database run (bpm 140, A minor and the detection record on the row) and the child environment.

## Proof
Re-run on the regenerated fixtures (decision 0017), with 112's second review round (seccomp,
no_new_privs, group kill) merged forward at b755414. As root, `STASH_REQUIRE_DB=1
STASH_REQUIRE_ISOLATION=1 pnpm worker:test`:
```
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
SKIPPED [1] tests/test_sandbox.py:167: measured on the job uid as root
298 passed, 2 skipped in 45.83s
```
The same suite as uid 65534 (setpriv, `STASH_REQUIRE_DB=1`); the skips are the isolation tests and
the empty `fixtures/own` case:
```
SKIPPED [1] tests/test_isolation.py:311: starting the child as another uid needs root
282 passed, 18 skipped in 37.11s
```
`uv run --frozen ruff check .` and `uv run --frozen ruff format --check .`:
```
All checks passed!
30 files already formatted
```
What each loop fixture gets. "No name" means named `untitled.wav`, and "chroma only" means the key
ignoring the name:

| Fixture | BPM, source, agreed | Candidates, best first | Bars | No name | Key | Chroma only |
| --- | --- | --- | --- | --- | --- | --- |
| drill_lead_142.flac | 142, filename, yes | 142, 284, 71 | 2 | 142, duration, yes | G minor, chroma, 0.275 | G minor (0.275) |
| midnight_keys_140bpm_Am.wav | 140, filename, yes | 140, 280, 70 | 4 | 140, duration, yes | A minor, filename | A minor (0.245) |
| dusty_soul_90_Dmin.wav | 90, filename, yes | 90, 180, 45 | 2 | 90, duration, yes | D minor, filename | D minor (0.299) |
| rnb_pad_72bpm_Ebmaj.aiff | 72, filename, yes | 72, 144, 288 | 2 | 72, duration, yes | E♭ major, filename | E♭ major (0.083) |
| trap_bells_150_F#m.mp3 | 150, filename, yes | 150, 75, 300 | 4 | 150, duration, yes | F♯ minor, filename | F♯ minor (0.222) |

- **The trimmed duplicate** is 0.25 s short of whole bars. It gets `onset`, 140 ±1, not agreed, with
  `bars` null.
- **Synthetic triads** are found in all 24 keys, and a 55 Hz kick under a C major loop does not pull the
  key to A.
- **Cost:** detection on a 60 s signal takes 0.12 s, with an 82 MB peak RSS.

## Not done
- One-shot root note is ticket 211.
- `pnpm run licenses` was not run here, because `node_modules` is not installed in this worktree. I
  checked numpy's metadata and its bundled `numpy.libs` (OpenBLAS only) by hand. CI runs the gate.
- The parser mirror covers `parseKey` and `formatKey`. `compatibleKeys` is in the same contracts
  `describe` block, but the worker has no use for it, so it is not mirrored.

## Surprises and decisions
- **librosa cannot pass the licenses gate.** Its required `soxr` is LGPL, its required `soundfile` ships
  LGPL `libsndfile`, and `certifi` (MPL) comes in through pooch. It was replaced by two numpy modules of about 160 lines each
  (request `113-librosa-licence`, accepted in decision 0017). The behaviour is the spec's; only the library differs.
- **The rnb_pad fixture read as G minor to chroma**, before decision 0017. The generator played a C
  *major* chord on vi in E♭ major. The lead fixed the generator: major keys now have a minor vi and minor
  keys a major VI. Every chord loop changed, so the numbers above are from the regenerated fixtures.
  Chroma alone now finds every loop's manifest key, and a new test holds it to that
  (`test_without_a_name_chroma_finds_every_loop_fixtures_key`). E♭ major has the smallest margin, 0.083
  over its relative C minor.
- **Name rules are stricter than `parseKey` on its own.** `parseKey("am")` is A minor, but in a file
  name "am", "a", "em" and "bb" are ordinary words. Lowercase tokens of one or two letters are ignored.
  "Am", "A", "dmin" and "f#m" count. A key followed by digits ("Cmaj7", "Am7") is a chord name and is
  ignored. A tempo glued in front ("150F#m") is cut off.
- **`bpmAgreed` with a name** means the name fits a whole-bar length (within 1%) *and* the onsets agree
  (within 2%). A name the audio disagrees with is kept, the most trusted source, but marked not agreed,
  and `bars` is then null.
- **Octave errors.** The whole-bar candidates are always a factor of 2 apart, so the onset score's job
  is exactly to choose the octave. Scoring the 1, 2 and 4 beat lags together chose the right octave on
  every fixture with no tempo prior. A prior (log distance from 120) is used only when the signal has no
  onsets at all.
- **numpy threads.** OpenBLAS starts a thread per core on import, which would hit the fixed RLIMIT_NPROC
  of the job uid on a large machine, the same trap ffmpeg hit in 112. The child environment pins it to
  1, and a test checks the task count after importing numpy.
- **A WIP commit.** 113 was paused for the PR #8 review round and committed as WIP (f8a7070), and 112
  was merged forward afterwards. In `test_sandbox.py`, 112's thread-count test replaced 113's earlier
  retry loop.

## Requests filed
- `docs/requests/113-librosa-licence.md`: change the spec's "librosa" wording to numpy (recommended), or
  grant licence exceptions for soxr, soundfile and certifi. **Answered in decision 0017:** numpy is
  accepted and the spec names it. The request file is kept, marked answered, as the record.
- The preview byte cap from 112 is now read from `limits.preview.loopMaxBytes` (decision 0017).
  `test_the_preview_cap_comes_from_limits_and_fits_the_longest_loop` keeps the derivation as a check that
  the limit is at least the derived size.
