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

## Review round (PR #8)
I merged `origin/phase-0/foundations` at 352f8ed first: the CI venv permissions, `peaksSchema` length,
and the compose read-only root, tmpfs and limits.

**B1: survivors between jobs (blocking).** Fixed in `sandbox.py`.
- `clear_job_user` runs before `_prepare` and after every job, including after a timeout. It starts a
  helper as the job uid that calls `kill(-1, SIGKILL)`, then reaps, and repeats until the uid's task
  count is 0. It raises if the uid will not empty, which fails the job as internal.
- The worker makes itself a child subreaper (`PR_SET_CHILD_SUBREAPER`), so orphans of a job come to it
  and are reaped instead of staying as zombies that count toward RLIMIT_NPROC.
- As the job user, RLIMIT_NPROC is now a fixed `CHILD_PROCESSES`. Same-uid development mode keeps
  "count + allowance".
- `_prepare` hands ownership over bottom-up with `os.fwalk(topdown=False, follow_symlinks=False)` and
  `chown(dir_fd=…, follow_symlinks=False)`, so the job user never owns a folder root is still walking.
- Docstring: the job uid must be dedicated, because all its processes are killed.

The tests (root):
- `test_a_child_that_escapes_with_setsid_does_not_outlive_its_job`: the double-forked survivor is
  dead, the uid has 0 tasks, and the next job sees no other job-uid process.
  A scratch run with `clear_job_user` replaced by a no-op showed the same survivor staying alive
  (`alive without the fix: True`).
- `test_a_survivor_left_from_before_is_killed_before_the_next_job`.
- `test_the_process_cap_is_fixed_for_the_job_user`.
- `test_prepare_never_follows_a_link_planted_in_the_job_folder`.

**B2: the parent decides what is published (blocking).** Fixed in `files.py`. Rules by item type and
role (`OUTPUTS`), and a loop publishes at most one file per role:
- **Preview:** `audio/mpeg`, path exactly `<item>/<sha256[:32]>.mp3`, at most `loop_preview_max_bytes()`,
  and it starts with ID3 or an MPEG frame sync. The cap is derived from 60 s at 128 kbps, plus 5% and
  16 KiB: 1,024,384 bytes (request `112-preview-max-bytes`).
- **Peaks:** `application/octet-stream`, path `<item>/<sha256[:32]>.peaks`, exactly `peakPoints` bytes,
  equal to base64 `meta.peaks`, with `meta.points` = 800.
- Anything else is refused: any other role, a second file of a role, any item type without rules yet,
  a child-supplied mime that differs, or a sha256 that is not 64 hex.
- Uploads use the parent's mime.
- `test_outputs_the_parent_does_not_expect_are_refused` has 24 cases, among them `text/html`, a `.svg`
  name, HTML bytes under an `.mp3` name, a file over the cap, an unknown role, two previews, a oneshot
  item, short peaks, peaks meta that differs or is not base64, a hard link and the wrong owner.

**Advisories:**
- **Security A1 (network):** the child gets its own network namespace. `unshare(CLONE_NEWNET)` runs in
  the forked child while it is still root, then it drops to the job user. `Popen(user=…)` is replaced
  by explicit `setgroups([])`, `setresgid` and `setresuid` in the same pre-exec step.
  - It is on whenever there is a job user. `STASH_CHILD_NETWORK=shared` opts out with a warning.
  - The worker refuses to start when the namespace cannot be created.
  - It needs CAP_SYS_ADMIN in compose (request `112-child-network`). Until then the compose worker
    needs `STASH_CHILD_NETWORK=shared`.
  - Tests: the child cannot connect to the parent's 127.0.0.1 listener and has only `lo`. The same
    probe connects with isolation off.
- **Security A2:** `open_beneath` requires `st_nlink == 1`, and, for `outcome.json` and outputs, the
  job uid as owner. Tests: a hard-linked outcome is a crash, and a hard link or the wrong owner is
  refused at publish.
- **Security A4:** child-supplied detail, schema messages and publish errors are logged with `%r`.
  Publish errors quote the child's role and path with `!r`.
- **Test A1:** the cap is fixed, so the test checks it through `run_isolated` with the count stubbed to
  10,000 for other uids: RLIMIT_NPROC is exactly 64.
- **Test A2:** `test_the_child_drops_the_parents_supplementary_groups` adds group 4242 to the parent.
- **Test A3:**
  - `test_the_task_count_adds_up_every_thread_of_the_uids_processes` counts a `/proc` tree built by
    hand, for any uid.
  - As root, `test_the_job_uid_task_count_counts_its_threads` measures the job uid while a child holds
    40 threads: exactly 41 tasks. That test needs 8 GiB of address space, because glibc reserves a 64 MB
    malloc arena per thread and a 1 GiB RLIMIT_AS stopped it at 19 tasks.
  - The real-thread test on the worker's own uid now runs only when not root, since root's count moves
    with every other root process. Under sudo it is measured on the job uid instead.
- **Test A4:** a 2 s, 48 kHz mono sine gives `loopSamples` 88200 at 44100, `channels` 1, and a 44.1 kHz
  stereo preview.
- **Contract C2:** `InputRejected` refuses a reason that is not a file-fault reason, like `Rejected`.

Checks. As root, `STASH_REQUIRE_DB=1 STASH_REQUIRE_ISOLATION=1 pnpm worker:test`:
```
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
SKIPPED [1] tests/test_sandbox.py:151: measured on the job uid as root
187 passed, 2 skipped in 34.25s
```
As uid 65534 (setpriv, `STASH_REQUIRE_DB=1`): `172 passed, 17 skipped in 31.09s`. The 16 isolation
tests and the empty `fixtures/own` case are skipped.

Ruff: `All checks passed!` and `26 files already formatted`.

## Decision 0017 and the second security re-review
**Requests answered (decision 0017), and both request files are removed:**
- `112-child-network`: compose gives the worker SYS_ADMIN. `STASH_CHILD_NETWORK=shared` is never set in
  compose or CI, and the startup message now says so.
- `112-preview-max-bytes`: `limits.preview.loopMaxBytes` = 1,024,384. `loop_preview_max_bytes()` reads
  it. `loop_preview_needed_bytes()` keeps the derivation, and a test checks the limit is at least that.

**Merge fallout:** foundations' 76b8476 fences upload completion with a token. The test helper
`queued_item` now claims the file with `claim_file_completion` and passes that token to
`enqueue_processing`, as `completeUpload` does, instead of setting `uploaded_at` by hand.

**N1, seccomp in the child (blocking):** new `seccomp.py`, a classic-BPF filter loaded through ctypes
and prctl. libseccomp is LGPL and is not used.
- `sandbox._child_setup` runs, in order: leave the network, drop to the job user, set
  `PR_SET_NO_NEW_PRIVS`, load the filter, apply the limits.
- The filter is built in the parent, so the forked child only makes the two prctl calls.
- It checks the audit architecture first and kills the process on a mismatch. On x86_64 it also
  refuses x32 syscall numbers.
- It returns EPERM for the 17 calls in the decision, EPERM for `clone` with any CLONE_NEW* flag
  (`0x7E020000`; CLONE_NEWTIME overlaps clone's exit-signal byte and only clone3 and unshare accept
  it), and ENOSYS for `clone3`.
- Syscall numbers for x86_64 and aarch64 were checked against this machine's `asm/unistd_64.h` and
  `asm-generic/unistd.h`.
- **Fail-closed:** with a job user, `run_isolated` refuses to run without a filter, and the worker
  refuses to start unless a probe child reports `NoNewPrivs: 1` and `Seccomp: 2`.
- In same-uid development mode the filter is also loaded on Linux, so a tool the filter breaks shows up
  in development too.
- **Tests:**
  - A child probe, run as the worker's uid in `test_sandbox` and as the job user in `test_isolation`,
    must give exactly: `unshare(CLONE_NEWUSER)` EPERM, `mount` EPERM, `clone(CLONE_NEWNS)` EPERM,
    `clone3` ENOSYS, `bpf` EPERM, `ptrace` EPERM, `NoNewPrivs` 1, `Seccomp` 2, a thread starts, and
    `ffmpeg -version` exits 0. A scratch run of the same probe with the filter off did not return that
    result: the child was killed.
  - A filter built for the other architecture kills its process with SIGSYS.
  - There is no filter for an unknown architecture.
  - The real FLAC decode runs as the job user under the filter, with an 8-task cap
    (`test_the_loop_processor_runs_as_the_job_user_within_its_limits`).

**A1, NoNewPrivs:** set by the child itself. It is checked at startup and in the probe above, so it no
longer depends on compose's `no-new-privileges`.

**A2, process-group kill and pid reuse:** the parent waits with `waitid(WEXITED | WNOWAIT)`, kills the
group while the child is an unreaped zombie, then reaps it. The pid, and so the group id, cannot have
been reused. A timeout does the same. Grandchildren that left the group are left to `clear_job_user`.

**A3, accepted:** replicas on one host that share the `stash-job` uid share its RLIMIT_NPROC count.
Each replica also kills every `stash-job` process before and after its jobs, which would kill the other
replicas' children. Until each job has its own container, run one worker replica per host, or give each
replica its own job uid.

**A4:** done; see `112-preview-max-bytes` above.

Checks after this round. As root, `STASH_REQUIRE_DB=1 STASH_REQUIRE_ISOLATION=1 pnpm worker:test`:
```
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
SKIPPED [1] tests/test_sandbox.py:156: measured on the job uid as root
192 passed, 2 skipped in 31.76s
```
As uid 65534: `176 passed, 18 skipped in 26.39s`. The skips are the 17 isolation tests and the empty
`fixtures/own` case. Ruff: `All checks passed!` and `27 files already formatted`.

## Third security review: the two advisories (decision 0017 addendum)
The third review closed N1, A1 and A2 with no blockers and left two advisories. Both are done.

**1. Probes that tell the filter being on from it being off.** Without CAP_SYS_ADMIN, `mount`,
`clone(CLONE_NEWNS)` and `bpf` fail with EPERM whether the filter is loaded or not, so they proved
nothing and are gone from the probe. In their place, `tests/syscall_probe.py` makes six calls that an
ordinary process here answers without error, as root and as uid 65534 alike:
- a raw `clone(CLONE_NEWUSER | SIGCHLD)`;
- `keyctl(KEYCTL_GET_KEYRING_ID, session)` and `add_key("user", ...)`;
- `userfaultfd(UFFD_USER_MODE_ONLY)`, which unprivileged processes may call since Linux 5.11;
- `io_uring_setup(1, ...)` and `open_tree(AT_FDCWD, "/", OPEN_TREE_CLOEXEC)`, one call each from the new
  deny entries that an unprivileged process can make.

`test_each_probe_is_refused_with_the_filter_and_answered_without_it` runs the probe twice in a fresh
process, once without the filter and once with it. Every call must be EPERM with the filter and none
may be EPERM without it. If an environment refuses one of these calls by itself, for example under
Docker's default profile without SYS_ADMIN, the test fails rather than passing for the wrong reason.
The job-child probe in `test_sandbox` and `test_isolation` now runs the same six calls, plus
`unshare(CLONE_NEWUSER)`, `clone3` (ENOSYS) and `ptrace(PTRACE_TRACEME)`, which also succeed without
the filter.

`tests/test_seccomp.py` (new, 9 cases) decodes `program()` for x86_64 and aarch64:
- The deny list is exactly the decided one.
- Every syscall number and audit architecture matches a table rewritten in the test from the kernel
  headers. The numbers are not read from `seccomp.py`.
- The exact instruction sequence: architecture load and check, KILL, number load, the x32 `JGE
  0x40000000` and its EPERM (x86_64 only), one `JEQ`/EPERM pair per denied call, clone3 ENOSYS, the
  clone flag test on args[0], and the final default ALLOW.
- A small classic-BPF interpreter runs the program. It checks that every denied call gives EPERM, that
  each `CLONE_NEW*` bit gives EPERM, that fork and pthread clone flags and ordinary calls give ALLOW, and
  that x32 numbers are refused. A foreign or i386 architecture gives KILL.

**2. More denied calls.** `DENIED` now also has the new mount API (open_tree, move_mount, fsopen,
fsconfig, fsmount, fspick and mount_setattr) and io_uring_setup, io_uring_enter and io_uring_register.
Since Linux 5.1 these numbers are shared across architectures (425 to 433, and 442), so one table
(`_COMMON`) serves both.

Checks. As root, `STASH_REQUIRE_DB=1 STASH_REQUIRE_ISOLATION=1 pnpm worker:test`:
```
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
SKIPPED [1] tests/test_sandbox.py:156: measured on the job uid as root
202 passed, 2 skipped in 39.52s
```
As uid 65534: `186 passed, 18 skipped in 34.06s`. Ruff: `All checks passed!` and `29 files already formatted`.
