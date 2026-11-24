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

## After merging 112's third-review advisories (3974bad)
112 gained the new mount API and io_uring deny entries, probes that differ with the filter off, and a
BPF decode test. They merged without conflict. As root, with isolation and the database required:
`308 passed, 2 skipped in 53.02s`. As uid 65534: `292 passed, 18 skipped in 36.11s`. Ruff: `All checks
passed!` and `32 files already formatted`.

## PR #13 review round
**Blocking: confidence is the margin.**
- `test_key_confidence_is_exactly_the_best_correlation_minus_the_second` (6 seeded random chromas) and
  `test_a_chroma_that_is_a_key_profile_...` write the 24 Pearson correlations out again in the test. They
  assert the confidence is exactly best minus second, rounded to 4 places, so a constant would fail.
- A relative-major and relative-minor blend (C major and A minor profiles) scores 0.0166, below
  `limits.bpm.keyConfidenceMin` (0.15).
- A clear i-iv-v-i progression scores above it: 0.1724 in C major and 0.2759 in A minor.
- **A lone tonic triad scores 0.0735, below the minimum.** C-E-G is most of A minor and E minor too, so
  the measure is right to call it unclear. The test asserts that as well. If the lead wants "a clear
  triad" to clear 0.15, the threshold, not the measure, is what would change.

**Must fix: octave errors on hats.** I reproduced the review's sweep with the probe's eighth-note hats
(`over.py` with `hat=True`). Before: 16 bad of 40, every one at double tempo and agreed. The fix is more
than normalising, because normalising alone made things worse. A slower octave's lags (2, 4, 8 beats)
are a subset of the faster one's (1, 2, 4 beats), so a mean of them cannot tell 90 from 45, and with the
old log1p(100|X|) the off-beat hats were as loud as the on-beat ones in the envelope. What changed in
`tempo.py`:
- **Lighter compression,** log1p(0.1|X|), so an accent survives into the envelope.
- **Unbiased autocorrelation:** each lag is divided by its overlap, and peaks are read within a frame
  (`_at(spread=True)`). Lags beyond 75% of the envelope are not used.
- **`strength`** is the mean of the measurable 1, 2 and 4 beat lags, normalised by their count.
- **`choose_octave`** starts at the fastest level with an onset on every beat (autocorrelation at one
  beat ≥ 60% of the best). It steps down at most one octave:
  - when the slower level is stronger by 0.05;
  - by 0.10 when the faster level is already inside 70 to 160, because a backbeat at 140 is "stronger
    at 70" in the same way accented hats at 70 are (replaced in the re-review, below);
  - on a near-tie, when only the slower level is inside 70 to 160. This is the mild prior.

  A loop with no low-end onsets (under 1.5% of onset energy below 200 Hz, so hats alone) uses 0.05
  inside the range too.
- **The duration tempo is the whole-bar candidate at the onsets' octave.** So `bpmAgreed` can only mean
  that the onsets heard that tempo (test below), and a name an octave from the onsets is never agreed.
- **No periodicity:** below 0.3 strength, white noise for example, the onsets give no tempo. The
  candidates are then ordered by the 120 BPM prior and nothing is agreed.

**Sweep after the fix** (`over.py`, 40 cases each; the review's probe, unchanged):
- Eighth-note hats (`hat=True`): **39 of 40.** The miss is 70 BPM, 1 bar (1.7 s), which gives 140,
  agreed. Both octaves are inside 70 to 160, and one bar is too short for the 4-beat lag.
- Quarter-note clicks (`hat=False`): **37 of 40** (it was 40 of 40). 174 at 2, 4 and 8 bars now gives
  87, agreed. That is the prior working as asked: a click on every beat at 174 cannot be told from
  eighths at 87, and 87 is the hip-hop reading. A 174 in the file name still wins. If the lead wants
  174 kept, the prior's top would move from 160 to about 180.
- The beatless pad gives an onset tempo (112 or 162), never agreed, the same as before the fix.
- Edge probe (`probe.py`):
  - No non-finite values anywhere. 0 samples no longer raises (it was a ZeroDivisionError).
  - Silence, all-NaN, a single NaN or inf, DC, 1e30 and white noise give the prior's 120, not agreed.

**NaN and inf.** `detect_bpm` and `pitch_chroma` run `nan_to_num` on the signal. A non-finite envelope,
autocorrelation or correlation gives no onset tempo or key, so nothing is agreed.

**Missing tests, added in `test_detection.py`:**
- Boom-bap drums made in the test: kick on 1 and 3, snare on 2 and 4, eighth hats, at 85, 88, 90, 92
  and 95 BPM over 2 and 4 bars. All give their tempo, duration, agreed. Fixtures are the lead's, so
  these are generated in the test. Ask if you want one in fixtures/.
- Eighth-note hats alone at 70, 80, 85, 90 and 100 BPM, over 2, 4 and 8 bars.
- M10: `beat_180bpm.wav` on a 90 BPM 2-bar loop gives 180 from the name, 4 bars, not agreed.
- 16 bars: drums at 140 BPM give 140, 16 bars, agreed.
- Agreement:
  - An onset tempo patched to the other octave is never agreed with a name.
  - `test_whatever_is_agreed_is_within_2_percent_of_the_onset_tempo` covers 24 patterns, with and without
    names.
- The silence prior: candidates `[120, 60, 240]`, and `[150, 75, 300]` for a 75/150 loop.
- White noise is not agreed. An empty signal has no tempo.
- `_tidy`: 141.9997 and 142.0049 become 142, while 87.07, 141.5 and 89.99 stay.
- `"\x1cAm"` and `"\u0085Am"` give None, and `" Am　"` gives A minor, all as JavaScript's
  trim does.
- A 40 Hz kick under a C major progression changes neither the key nor its confidence (within 0.01).
- NaN and inf for key and tempo.
- Hats alone have no low-end onsets; drums with a kick do.

Checks. As root, `STASH_REQUIRE_DB=1 STASH_REQUIRE_ISOLATION=1 pnpm worker:test`:
```
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
SKIPPED [1] tests/test_sandbox.py:167: measured on the job uid as root
387 passed, 2 skipped in 48.78s
```
As uid 65534: `371 passed, 18 skipped in 37.15s`. Ruff: `All checks passed!` and `32 files already formatted`.
Every loop fixture still gets its manifest BPM, bars and key, with and without its name.

## PR #13 re-review (at 20064aa)
**Must fix: fast drums were halved.** With a kick on 1 and 3, the half-note level is always "stronger".
The 0.10 in-range step (STEP_CLEAR) let the test's own drums read 64 at 128 BPM (4 and 8 bars) and 75 at
150 BPM (2 bars), all three agreed. The new rule in `choose_octave`:
- A level already inside 70 to 160 steps down only when the loop has no low-end onsets (hats alone),
  and then only to a tempo still inside 70 to 160. STEP_CLEAR is gone.
- No step can land below `limits.bpm.min`.
- The module docstring now says what agreement means. Agreement needs the onsets: a name or a duration
  fit with no onset tempo to check it (silence, noise) is never agreed, so the loop gets "check this".
  This follows the lead's decision on file name plus silence.

**Tests added:**
- `test_fast_drums_with_a_kick_on_1_and_3_are_not_halved` asserts `t.bpm == bpm`, duration, agreed and
  bars. It covers drums from 110 to 160 BPM in steps of 5, at 2, 4 and 8 bars, with and without off-beat
  hats: 66 cases.
- `choose_octave` unit tests:
  - the near-tie branch: ±0.03 steps into the prior, -0.07 stays, and both levels outside need a clear
    gain;
  - the in-range rule: a backbeat stays, hats alone step, and 64 is refused;
  - the bpm minimum;
  - the fastest level with an onset on every beat: just below PERIODIC_SHARE it is skipped, and just
    above it counts.
- The advisories:
  - drums with one NaN, inf or -inf sample give `(90, True)`;
  - white noise gives `(120, "duration", False, 2)`;
  - a name on a silent loop gives `(120, "filename", False, 2)`.

**Mutation check.** Each change below, made alone, fails at least one test:
- `gain > -STEP_DOWN` to `> STEP_DOWN`;
- removing `nan_to_num`;
- removing MIN_PERIODIC;
- ignoring PERIODIC_SHARE;
- restoring the old in-range rule;
- removing the bpm-minimum guard.

**Sweep.** The review's `over.py`, unchanged:
```
== over (quarter-note clicks, hat=False)
clicks 174bpm 2bars -> 87.0 duration agreed=True cand=[87.0, 174.0]
clicks 174bpm 4bars -> 87.0 duration agreed=True cand=[87.0, 174.0, 43.5]
clicks 174bpm 8bars -> 87.0 duration agreed=True cand=[87.0, 43.5, 174.0]
clicks ok 37 bad 3
beatless pad 120 1bars -> 162.0 onset agreed=False
beatless pad 90 2bars -> 112.0 onset agreed=False
beatless pad 140 4bars -> 112.0 onset agreed=False
beatless pad 72 2bars -> 112.0 onset agreed=False
== over with hat=True (eighth-note hats)
clicks 70bpm 1bars -> 140.0 duration agreed=True cand=[140.0, 70.0, 280.0]
clicks ok 39 bad 1
```
The 174 to 87 result is accepted in decision 0018. The drums from `test_detection.drums()`, from 70 to
160 BPM in steps of 5, at 1, 2, 4 and 8 bars, with no name:
```
drums ok 76 bad 0 []
hats ok 75 bad 1 [(70, 1, 140.0, 'duration', True)]
kick_snare ok 76 bad 0 []
```

Checks. As root, `STASH_REQUIRE_DB=1 STASH_REQUIRE_ISOLATION=1 pnpm worker:test`:
```
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
SKIPPED [1] tests/test_sandbox.py:167: measured on the job uid as root
458 passed, 2 skipped in 46.01s
```
As uid 65534: `442 passed, 18 skipped in 37.53s`. Ruff: `All checks passed!` and `32 files already formatted`.
