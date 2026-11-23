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

## What changed
All of it is under `apps/worker/`.
- `audio/ffmpeg.py` and `audio/loop.py` (new): the loop processor, registered for `process_loop`.
  - Sniffs the type from the leading bytes.
  - Every ffmpeg call names its demuxer and allows only the `file` protocol.
  - Decodes to 44.1 kHz stereo f32, bounded to the limit plus 1 s. Rejects `corrupt_file`, `too_long` and `silent` (peak below -60 dBFS).
  - Two-pass loudnorm to -14 LUFS with a -1 dBTP true peak. CBR MP3 at 192 kbps up to 20 s, 128 kbps beyond.
  - 800 peak bytes from the preview's mono mix.
  - Content-hashed names: `<item>/<sha256[:32]>.mp3` and `.peaks`.
- `storage.py` (new): the `Storage` protocol, with `S3Storage` and `LocalStorage`.
  - `S3Storage` uses boto3, path-style addressing, capped downloads, and `ContentLength` with `Cache-Control` on put.
  - `LocalStorage` is for tests.
- `files.py` and `safefs.py` (new):
  - `stage_inputs`: `too_large` is decided before any download, and the downloaded size must equal the row's size.
  - `publish_outputs`:
    - Uploads only the files the validated result names, from the previews bucket under the item.
    - Opens each file with O_NOFOLLOW at every component.
    - Checks each file's size and SHA-256 against the result.
    - Copies everything to parent-owned staging before the first upload, so a refusal uploads nothing.
- `sandbox.py`: the child can run as `JobUser` (`Popen(user=, group=, extra_groups=[])`).
  - The job folder stays root-owned 0711. `work/`, `home/`, `tmp/` and `report/` are owned by the job uid, 0700.
  - The child writes `report/outcome.json`, and the parent reads it with `open_beneath`.
  - The process allowance counts the job uid's tasks.
- `runner.py`: after validating the job input, the runner checks the item type and stages the inputs, then runs the child as the job user. It publishes the outputs before `worker_complete`.
  - `InputRejected` fails non-retryable with its reason.
  - A storage or publish error fails as `internal`, retryable.
- `config.py` and `__main__.py`:
  - New settings `STASH_JOB_USER`, `STASH_WORKER_ALLOW_SAME_UID`, `STASH_S3_*` and `STASH_BUCKET_*`.
  - The worker refuses to start without a job user, unless the same-uid override is set (logged as a warning).
  - A job user requires the worker to run as root.
- `Dockerfile`: a system user `stash-job` (uid 10001) and `ENV STASH_JOB_USER=stash-job`.
  - The parent runs as root (`USER worker` removed), and `/app` is world-readable.
  - The command runs the venv's python directly.
- Tests:
  - New: `test_audio.py`, `test_storage.py` (botocore Stubber for S3) and `test_isolation.py`.
  - The runner tests now cover staging, publishing and the job user.
  - The real-database tests take a loop fixture from queued to ready with a preview and peaks, and a hostile fixture back to draft with `unsupported_format`.

## Proof
Lane check as root, with isolation required (`STASH_REQUIRE_DB=1 STASH_REQUIRE_ISOLATION=1 pnpm worker:test`):
```
..................................s..................................... [ 45%]
........................................................................ [ 90%]
................                                                         [100%]
=========================== short test summary info ============================
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
159 passed, 1 skipped in 33.56s
```
The same suite as uid 65534. Run from `apps/worker` with `setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp STASH_REQUIRE_DB=1 .venv/bin/python -B -m pytest -q -p no:cacheprovider -rs`:
```
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
SKIPPED [1] tests/test_isolation.py:73: starting the child as another uid needs root
SKIPPED [1] tests/test_isolation.py:81: starting the child as another uid needs root
SKIPPED [1] tests/test_isolation.py:88: starting the child as another uid needs root
SKIPPED [1] tests/test_isolation.py:95: starting the child as another uid needs root
SKIPPED [1] tests/test_isolation.py:108: starting the child as another uid needs root
SKIPPED [1] tests/test_isolation.py:122: starting the child as another uid needs root
SKIPPED [2] tests/test_isolation.py:142: starting the child as another uid needs root
151 passed, 9 skipped in 28.54s
```
The isolation tests, as root (`-v`):
```
tests/test_isolation.py::test_the_child_runs_as_the_job_user PASSED
tests/test_isolation.py::test_the_child_cannot_read_a_worker_only_file PASSED
tests/test_isolation.py::test_the_child_cannot_read_the_workers_environment_or_signal_it PASSED
tests/test_isolation.py::test_the_job_folder_belongs_to_the_job_user_and_the_parent_still_reads_the_outcome PASSED
tests/test_isolation.py::test_a_timeout_still_kills_a_child_running_as_the_job_user PASSED
tests/test_isolation.py::test_the_runner_passes_the_job_user_and_removes_the_folder PASSED
tests/test_isolation.py::test_the_loop_processor_runs_as_the_job_user_within_its_limits[64] PASSED
tests/test_isolation.py::test_the_loop_processor_runs_as_the_job_user_within_its_limits[8] PASSED
8 passed
```
`uv run --frozen ruff check .` and `uv run --frozen ruff format --check .`:
```
All checks passed!
26 files already formatted
```
The test_contracts skip was there before this ticket: `fixtures/own/` is empty. ffmpeg is 6.1.1 (Ubuntu 24.04, the same as CI).

How each acceptance criterion is tested:
- Separate uid: `test_the_child_cannot_read_a_worker_only_file` (a 0600 root file gives `PermissionError`), plus the environ and signal test.
- Type from the leading bytes: `test_the_type_comes_from_the_leading_bytes`, and the hostile fixture tests (`actually_an_exe.wav` gives `unsupported_format`).
- Decode, silence and over 60 s: the hostile fixture reasons (`silent`, `too_long`, `corrupt_file`) and `test_a_truncated_file_of_a_real_format_is_corrupt`.
- Preview: `test_the_preview_is_loudness_matched_mp3_under_500kb`, run on every loop fixture. ebur128 measures -14 +/- 1 LUFS and at most -1 dBTP, and checks the bitrate from limits and a size under 500 KB.
- Peaks: `test_peaks_are_800_bytes_from_the_mono_mix` and `test_peaks_of_an_out_of_phase_stereo_file_are_flat`.
- Content-hashed names in the previews bucket: `test_derived_files_have_content_hashed_names_under_the_item`, plus the real-database run.
- Every loop fixture's `loopSamples` and `sampleRate`: `test_every_loop_fixture_gives_the_expected_length_and_rate`.

## Not done
- BPM and key are ticket 113, and fingerprints are ticket 114. The result carries null or empty values for them.
- I could not build the worker image: Docker Hub answered `429 Too Many Requests` for `python:3.12-slim`. The Dockerfile change is small, but it is unverified. Please build it once with `docker compose --profile worker build`.
- CI still runs the suite as a non-root user, so it skips the isolation tests (request below).

## Surprises and decisions
- **ffmpeg threads count toward RLIMIT_NPROC.** Left to itself, ffmpeg starts threads per core: 12 for a FLAC decode on 4 cores. Under the job uid's allowance of 64 tasks, a large machine would fail. Every call now passes `-threads 1` and `-filter_threads 1`. `test_the_loop_processor_runs_as_the_job_user_within_its_limits[8]` failed before that change and passes after it, so the processor fits in 8 tasks. The clips are at most 60 s, so the speed cost is small.
- **Where the numbers come from:**
  - Peaks are taken from the preview, so the waveform matches what plays.
  - `details.loudnessLufs` and `truePeakDb` are measured on the original, because the contract says "of the original".
  - `loopSamples` is the frame count after resampling to 44.1 kHz.
- **The outcome file moved to `report/outcome.json`.** The child owns `work/`, so a file written there by the parent could be replaced by the child. `report/` is the one folder the child writes its outcome to, and the parent reads it without following links.
- **The parent runs as root in the image.** That is the cost of "a separate uid" without a container per job. Request 112-worker-isolation-ci drops every capability except six.
- **Limits of this isolation:**
  - A child that calls `setsid()` leaves the process group, and the timeout kill only reaches the group.
  - RLIMIT_NPROC on the job uid bounds how far a child can fork.
  - A cgroup or a container per job would close this. That fits better with the Vital renderer (215).
- **macOS has no memory cap.** RLIMIT_AS is applied only on Linux, as in 111.
- **I made one older test deterministic.** `test_the_child_runs_under_resource_limits` (from the 111 CI fix) compared RLIMIT_NPROC against root's live task count. On this shared host, that count moved by 86 between the child's start and the assertion, and the test failed. It now pins the count with a stub and asserts the limit equals the count plus `CHILD_PROCESSES` exactly. That is tighter than the old range. The real count is still covered by the thread-counting test.
- **moto was dropped** because it pulls certifi (MPL-2.0). The S3 tests use botocore's Stubber.

## Requests filed
- `docs/requests/112-worker-isolation-ci.md`: CI runs the isolation tests as root with `STASH_REQUIRE_ISOLATION=1`, and compose drops capabilities for the root parent.
- `docs/requests/112-peaks-meta.md`: name the `peaks` file's meta (`{points, peaks}` base64) in the worker-result contract, for Platform's `item.peaks`.

## After decision 0014 (both requests accepted)
I merged `origin/phase-0/foundations` at 6b7946c. It adds the CI isolation step, the compose capabilities and `peaksFileMetaSchema` on the worker result. No worker code had to change: the processor already writes `{points, peaks}` on the peaks file, and the regenerated schema accepts it. `lane/pipeline-111` writes no peaks file, so it did not need the merge. I reran the checks:
```
STASH_REQUIRE_DB=1 STASH_REQUIRE_ISOLATION=1 pnpm worker:test (root)   159 passed, 1 skipped in 32.79s
same suite as uid 65534 (setpriv, STASH_REQUIRE_DB=1)                  151 passed, 9 skipped in 29.10s
uv run --frozen ruff check .                                           All checks passed!
uv run --frozen ruff format --check .                                  26 files already formatted
```
