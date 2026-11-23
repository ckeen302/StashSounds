# Handoff 112 Audio decode, loudness-matched preview, peaks, exact loop length

## Plan (written before implementation, at the top of the handoff as in ticket 111; the playbook has no
separate plan folder and docs/ outside handoffs and requests is the lead's)

Branch `lane/pipeline-112` from `origin/lane/pipeline-111` (PR #3), with `origin/phase-0/foundations` merged.

**Isolation (new criterion).** The parent stays the only process with credentials. Each child runs as a
separate unprivileged uid (`STASH_JOB_USER`, `stash-job` in the image) through `Popen(user=, group=,
extra_groups=[])`, so it cannot read worker-only files or the worker's `/proc/<pid>/environ`, or signal the
worker. The worker image's parent runs as root, because only a privileged process can start another uid.
The compose file should drop every capability except the few needed (request). The job folder is chowned to
the job uid. The process allowance counts the job uid's tasks. `python -m stash_worker` refuses to start
without a job user unless `STASH_WORKER_ALLOW_SAME_UID=1` (dev on a laptop, logged as a warning).
Tests: as root, a handler run as the job user cannot read a 0600 file owned by the worker uid, cannot read
the parent's environ, and cannot signal the parent. They skip when the tests are not root, unless
`STASH_REQUIRE_ISOLATION=1` (request: CI runs them in the worker image or with sudo).

**Storage stays in the parent.** `storage.py` defines a `Storage` protocol with two implementations: `S3Storage`
(boto3, path-style, for SeaweedFS and R2) and `LocalStorage` (a folder, for tests).
- Before the child starts, the parent downloads each input file to `job/in/<file id>`. Sizes are checked
  against limits.json first and the download is capped. A file over its limit fails with `too_large`.
- After the child, the parent uploads only the files the validated result names. Each comes from
  `job/out/<bucket>/<path>`, is opened without following symlinks at any level, and must match the size and
  SHA-256 in the result. Only the previews bucket is allowed, under the item's folder. Content-hashed names
  get `Cache-Control: public, max-age=31536000, immutable`.
- A storage error is retried (`internal`, retryable).

**Loop processor (`audio/`).** Registered for `process_loop`. It runs in the child.
1. Sniff the real type from the leading bytes: RIFF/WAVE, FORM/AIFF or AIFC, fLaC, or MP3 (ID3, or an MPEG
   frame sync). It must be one of `limits.loop.formats`, otherwise `unsupported_format`.
2. Decode with ffmpeg to 44.1 kHz stereo f32, bounded to the limit plus one second. A decode failure or no
   audio is `corrupt_file`. Over `maxDurationMs` is `too_long`. A peak below -60 dBFS is `silent`.
3. Measure the original with loudnorm's first pass. Its integrated loudness and true peak become
   `details.loudnessLufs` and `details.truePeakDb` (the contract says "of the original").
4. Write the preview with the loudnorm second pass (I=-14, TP from limits), resample to 44.1 kHz, and encode
   MP3 at 192 kbps up to 20 s or 128 kbps beyond. A test measures the encoded file with ebur128:
   integrated -14 +/- 1 LU and true peak at or below -1 dBTP.
5. Peaks: 800 bytes, each the peak of a slice of the preview's mono mix, scaled to 0..255. Stored as a
   `peaks` file, with the same bytes base64-encoded in `meta.peaks` so item rows need no second request
   (request: name that key in the contracts).
6. Result: `loopSamples` (the decoded frame count at 44100), `sampleRate` 44100, the original's channel count,
   `durationMs`, and `bars` null. Detection fields are null or empty, and bpm, key and fingerprints are left
   to 113 and 114.

**Tests first.** Sniffing; every loop fixture's loopSamples and sampleRate; every hostile loop fixture's
reason; preview loudness, true peak, bitrate and size under 500 KB; 800 peaks; content-hashed names;
publish refusing symlinks, a wrong hash or a path outside the item; S3Storage calls through botocore's
Stubber; isolation; and a real-database run with LocalStorage from enqueue to ready. Worker tests run as
root and as a non-root uid.

New dependency: boto3 1.44 (Apache-2.0), with botocore, s3transfer (Apache-2.0), jmespath (MIT), urllib3
(MIT), six (MIT) and python-dateutil (now 2.9, Apache-2.0 or BSD). Reason: the S3 API for SeaweedFS and R2.
I tried moto for S3 tests and removed it: it pulls certifi (MPL-2.0), which the licenses gate refuses for
anything not on its dev list.
