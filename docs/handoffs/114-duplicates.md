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
