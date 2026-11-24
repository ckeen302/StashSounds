# Handoff 114 SHA and Chromaprint duplicate check, flagged status with reason

## Plan (written before implementation, at the top of the handoff as in 111 to 113)

Branch `lane/pipeline-114` from `lane/pipeline-113` at 3acc94d (112's third-review advisories merged).

**Where each step runs.**
- **SHA-256, in the parent.** The parent already holds the staged original (`job/work/in/<file id>`)
  and only hashes bytes, which is safe on a hostile file.
- **Fingerprint, in the child.** `fpcalc` decodes audio, so it runs in the sandboxed child with the
  rest of the loop processor. It never sees the uploaded container: it reads the child's own decoded
  44.1 kHz stereo f32 file, with the format forced (`-format f32le -rate 44100 -channels 2 -raw
  -signed -json`). That gives signed 32-bit items, which fit `fingerprints.chromaprint int[]` and the
  contract's `z.int()`. The result carries them as `fingerprints: [{filePath: <original's path>,
  durationMs, chromaprint}]`.
- **Comparison, in the parent,** after the child's result is validated and before anything is published
  or completed. The parent sets `flag` on the result, then validates the result again.

**Licence.** Chromaprint and fpcalc are LGPL-2.1+, and the Debian fpcalc links FFmpeg. The worker only
runs `fpcalc` as a separate program (`subprocess.run`, a fixed argument list), the same way it runs
`ffmpeg`. Nothing is linked or imported, and no Python binding (pyacoustid, chromaprint) is added. The
Dockerfile and CI already install `libchromaprint-tools`.

**Reading the catalog needs a database function (request 114-duplicate-lookup).** db.py's rule
(decision 0012) is that the worker calls only the worker functions, with no table reads. I am asking
the lead for:
```
public.worker_duplicate_candidates(p_job_id uuid, p_attempt int, p_file_id uuid, p_sha256 text,
                                   p_min_duration_ms int, p_max_duration_ms int)
  returns table (match text, item_id uuid, owner_id uuid, duration_ms int, chromaprint int[])
```
It is fenced by `worker_run`, and `p_file_id` must be this item's original. It records `p_sha256` on
that original. Storing it at lookup time, not at completion, means a second upload of the same file
running at the same moment already sees the first. It returns `exact` rows, which are other items'
originals with that SHA-256, and `fingerprint` rows, which are other items' fingerprints with
`duration_ms` in the range. Items in `draft` are left out. Until the migration lands, the worker's
database tests install the proposed function from `apps/worker/tests/sql/` when it is missing. That
file is to be deleted when the migration merges.

**Matching.**
- **Exact:** any `exact` row flags `duplicate_exact`.
- **Fingerprint:** the candidates are fingerprints whose duration is within 0.75 to 1/0.75 of the
  upload's. Similarity is 1 minus the bit error rate over the best alignment, among the offsets where
  the overlap covers at least 90% of the shorter fingerprint. Similarity over
  `limits.worker.fingerprintThreshold` (0.90) flags `duplicate_fingerprint`.
- **Order:** an exact match wins over a fingerprint match, and another user's match wins over the
  uploader's own.
- **The uploader's own file:** it is flagged with the same reason. `WORKER_REASON_TEXT` for both
  duplicate reasons already ends "If it is yours, tell us and we will review it.", which invites
  review. `flag.detail` says it matched the uploader's own upload.
- **Too short to fingerprint:** fpcalc returns no fingerprint below about 2.6 s, so the upload gets the
  SHA check only, and the result has no fingerprint.

**Tests first.**
- Fingerprints of every loop fixture are non-empty signed int32 values, and they are deterministic.
- Similarity of the three duplicate fixtures to the original is over the threshold. Every pair of
  different loop fixtures is under it. More copies are made in the test with ffmpeg: 64 kbps MP3, -6 dB
  gain, and 0.5 s trimmed off the end. They must be over it too.
- `screen()` decisions against fake candidates: exact against another user, exact against the uploader,
  a fingerprint match, an exact match winning over a fingerprint match, a candidate outside the overlap
  rule, and no match.
- The runner, with the fake queue, looks up with the staged file's SHA-256 and the duration range. A
  `conflict` does nothing, and a queue error fails `internal`, retryable.
- A real-database run takes `midnight_keys_140bpm_Am.wav` to ready, with the original's SHA-256 and a
  fingerprint row stored. The copy, the trimmed copy and the re-encoded copy, each from another user,
  come out flagged with the manifest reason. The same user's copy is flagged `duplicate_exact`, and a
  different loop is ready.
- The isolation test runs the loop processor, now with fpcalc, as the job user under the 8-task cap.

The threshold is tuned on the fixtures and its numbers are reported below. The decision file is the
lead's, so I am asking for it in the same request.

## What changed
All of it is under `apps/worker/`, except this handoff and the request.
- **`audio/fingerprint.py`** (new): `fingerprint(decoded)` runs `fpcalc -format f32le -rate 44100 -channels
  2 -length 120 -raw -signed -json` on the child's own decode. It returns signed 32-bit items, or None
  for "Empty fingerprint" (audio of about 2.6 s or less). It refuses output that is not int32.
- **`audio/loop.py`:** the child fingerprints the decode before deleting it. The result carries
  `fingerprints: [{filePath: <original's path>, durationMs, chromaprint}]`, and `flag` stays null: the
  child never decides a duplicate.
- **`screen.py`** (new, parent):
  - `sha256_file` and `duration_window` (0.75x to 1/0.75x).
  - `similarity`: 1 minus the bit error rate at the best alignment covering ≥90% of the shorter
    fingerprint, with numpy `bitwise_count`.
  - `screen()`: one lookup per original, then the flag. Exact wins over fingerprint, and another user
    wins over the uploader. A flag the handler set is kept. It refuses a fingerprint for a path that is
    not this job's original.
- **`db.py`:** `PgJobQueue.duplicate_candidates()` calls `public.worker_duplicate_candidates` (request
  114-duplicate-lookup) and checks each row's `match`.
- **`runner.py`:** after the result validates, the runner screens it and validates it again, and only
  then publishes and completes.
  - A lookup `conflict` does nothing.
  - Any other lookup error, or a refused fingerprint, fails `internal`, retryable, with nothing
    uploaded.
  - A flagged item is still published (preview and peaks) and completes as `flagged`, so its owner and
    admins can hear it.
- **Tests:**
  - `test_duplicates.py` (new, 25 cases).
  - 4 runner cases with the fake queue.
  - 7 real-database cases.
  - `test_audio.py` now expects one fingerprint per loop fixture.
  - `conftest.py`: the stand-in SQL from `tests/sql/`, an `owner=` argument for `queued_item`, and an empty
    catalog (no fingerprints, no original hashes) at the start of each database test.

## Proof
As root, `STASH_REQUIRE_DB=1 STASH_REQUIRE_ISOLATION=1 pnpm worker:test`, with 113's PR #13 fixes merged
(32823e5):
```
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
SKIPPED [1] tests/test_sandbox.py:167: measured on the job uid as root
425 passed, 2 skipped in 66.90s (0:01:06)
```
As uid 65534 (setpriv, `STASH_REQUIRE_DB=1`): `409 passed, 18 skipped in 61.43s (0:01:01)`. The skips are the
isolation tests and the empty `fixtures/own` case. Ruff: `All checks passed!` and `35 files already
formatted`. `test_the_loop_processor_runs_as_the_job_user_within_its_limits[8]` passes: fpcalc runs as
the job user under the seccomp filter and the 8-task cap.

How each criterion is tested:
- **SHA-256 of the original; an exact match flags `duplicate_exact`:**
  - `test_a_processed_original_keeps_its_sha256_and_fingerprint`: the stored hash is the file's, and
    `fileName` in the original's meta is untouched.
  - `test_each_duplicate_fixture_is_flagged_after_its_original[midnight_keys_copy.wav]`.
- **The fingerprint is stored per original; over the threshold, against similar durations, flags
  `duplicate_fingerprint`:**
  - The same test checks the `fingerprints` row: `item_file_id` is the original, 6857 ms, 34 items.
  - `[midnight_keys_trimmed.wav]` and `[midnight_keys_reencoded.mp3]`.
  - `test_the_duration_window`.
- **fixtures/generated/duplicates:** all three are flagged with the manifest's reason after the
  original, from another user, and each gets one `flag` notification.
- **The same user is flagged too:** `test_the_same_user_re_uploading_their_own_loop_is_flagged_too`
  gives the copy `duplicate_exact` and the trimmed copy `duplicate_fingerprint`. `flag.detail` says "your
  own earlier upload" (`test_the_uploaders_own_file_is_flagged_too_and_says_so`).
- **Threshold tuned on the fixtures:** the numbers are below. The decision file is requested.
- **Also tested:**
  - Different loops are never duplicates of each other.
  - A draft is not screened against.
  - The lookup is fenced to the claimed attempt (`conflict`) and to the job's own original (`invalid`).

**Threshold measurements** (`similarity`, fpcalc 1.5.1). Every fixture has 22 to 34 items, except
drill_lead (6 items, 3.4 s).

| Pair | Similarity |
| --- | --- |
| midnight_keys and `_copy.wav` | 1.000 |
| and `_trimmed.wav` (0.25 s off the front) | 0.996 |
| and `_reencoded.mp3` | 0.995 |
| and a 64 kbps MP3 (made in the test) | 0.992 |
| and -6 dB, 0.5 s off the end, 0.5 s off the start | 1.000, 1.000, 0.994 |
| and pitched up a semitone | 0.635 (not caught) |
| and sped up 5% | 0.878 (not caught) |
| closest two different loops (drill_lead and midnight_keys, outside each other's window) | 0.781 |
| closest two different loops inside each other's window (dusty_soul and trap_bells) | 0.749 |

So 0.90 sits between 0.781 and 0.992, and I propose keeping it. **Cost:** comparing two 60 s
fingerprints (476 items) takes 0.4 ms, and fpcalc on a 60 s decode takes 0.06 s.

## Not done
- **The migration.** `worker_duplicate_candidates` is a stand-in in `tests/sql/` until the lead adds it.
  Deploying this branch before the migration makes every loop job fail `internal` and retry, then go
  back to draft. Nothing goes unscreened to ready.
- **Kits** (fingerprint every sample; flag the kit over a share) are ticket 212 with the kit processor.
  `screen()` already takes several originals, and kit samples would add fingerprint rows with their own
  `filePath`.
- **A cap on candidates.** Every fingerprint in the duration window is compared. That is fine for phase 1,
  and a later index or cap is noted in the request.
- **The pnpm licenses gate** was not run here: there is no `node_modules` in this worktree. No Python
  dependency was added.

## Surprises and decisions
- **Licence.** Debian's `libchromaprint-tools` 1.5.1 lists Chromaprint as Expat (MIT), with LGPL-2.1+
  resampler files, and fpcalc links the distro's FFmpeg libraries. As the lead asked, it is treated as
  LGPL: fpcalc is only ever a separate program (`subprocess.run` with a fixed argument list, like
  ffmpeg). Nothing is linked or imported, and no Python binding is added. It is installed from apt in
  the Dockerfile and in CI, which were already in place. I installed the same package here.
- **fpcalc never sees the upload.** It reads the child's f32 decode with the raw demuxer forced, so a
  hostile container reaches only ffmpeg's already-pinned demuxer, once.
- **Hash recorded at lookup, not at completion.** `worker_complete`'s upsert would overwrite the
  original's meta (`fileName`, `copiedAt`). Recording at lookup also closes the race between two
  simultaneous uploads of the same file. For fingerprints the race stays open: they are stored at
  completion. Two near-copies processed in the same second can both reach ready.
- **Short loops.** Below about 2.6 s, fpcalc gives no fingerprint, so only the SHA-256 check applies.
  drill_lead (3.4 s) has 6 items. A very short fingerprint has fewer bits behind its score, but the
  duration window keeps it away from long loops.
- **The flag's detail is dropped by `worker_complete`.** So the own-upload wording reaches nobody yet.
  The contracts' reason texts already invite review ("If it is yours, tell us and we will review it").
  The request offers a column, as an option.
- **Residual risk.** A child compromised through ffmpeg could report a forged fingerprint. That could
  flag later honest uploads of the content it imitates. It cannot hide its own file, because the hash
  comes from the parent, and it cannot write another item's rows.
- **Test isolation.** The worker's database is shared by the session, so each database test now starts
  with no fingerprints and no original hashes. Otherwise the 113 fixture test would make the 114 ones
  duplicates, and the reverse.

## Requests filed
- `docs/requests/114-duplicate-lookup.md`:
  1. The `worker_duplicate_candidates` migration, with the exact SQL.
  2. A decision recording the 0.90 threshold and the numbers above.
  3. Optional: a place for `flag.detail`.
