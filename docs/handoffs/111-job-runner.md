# Handoff 111 Job runner: claim, time and memory limits, retries, status updates

## Plan (written before implementation; pre-approved by the lead within the ticket and lane)

Files (all under apps/worker/):
- `src/stash_worker/config.py`: settings from the environment (`DATABASE_URL`, poll and idle backoff,
  memory cap), falling back to the repo's `.env.local` that `pnpm dev` writes (dev.mjs does not export it).
- `src/stash_worker/db.py`: `JobQueue` protocol with exactly four calls (claim, complete, fail,
  requeue_stale), and `PgJobQueue`, which runs each call in its own transaction under
  `set local role service_role` and does nothing else. No table reads or writes.
- `src/stash_worker/contracts.py`: add `worker_reasons()`, read from the generated worker-result schema
  (no retyped enum).
- `src/stash_worker/jobs.py`: the handler registry (`kind -> "module:function"`), `Rejected(reason)` for
  bad input, per-kind timeouts from limits.json.
- `src/stash_worker/sandbox.py` and `child.py`: run one handler in a fresh Python process with
  `RLIMIT_AS` (memory) set before exec, its own process group, and a wall-clock timeout that kills the
  whole group. The outcome comes back as a JSON file beside the job's work folder.
- `src/stash_worker/runner.py`: claim, validate the payload against job-payload.schema.json, make a
  temporary folder, run, validate the result against worker-result.schema.json, then worker_complete or
  worker_fail; folder deleted in `finally`. Idle backoff when the queue is empty, periodic
  requeue_stale_jobs, reconnect on database errors, graceful stop on SIGINT/SIGTERM.
- `src/stash_worker/__main__.py`: `python -m stash_worker` starts the loop.

Outcome mapping: handler result valid -> worker_complete; `Rejected(reason)` -> worker_fail(reason,
retryable=false); timeout -> worker_fail('timeout', true); crash, memory cap, invalid result, missing
handler or a failing worker_complete -> worker_fail('internal', true).

Tests (tests first): sandbox (timeout kills the group, memory cap, crash, rejection, folder removed),
runner against a fake queue (every outcome mapping, idle backoff, schema validation), and runner against
a real Postgres built from shim.sql plus the migrations (backoff 30 s then 2 min, final failure returns
the item to draft, two workers never claim the same job, stale running jobs requeued). Database tests skip
when no Postgres is reachable, unless `STASH_REQUIRE_DB=1`.

New dependency: pg8000 (BSD-3-Clause). psycopg is LGPL and fails the licenses gate.

## What changed
- **`python -m stash_worker`** polls `claim_job` as `service_role`, with doubling idle backoff (1 s to
  15 s, `STASH_WORKER_IDLE_MIN_S` / `_MAX_S`) when the queue is empty or the database is down. It runs
  `requeue_stale_jobs` every 60 s with a threshold of the longest timeout plus 60 s (660 s). First
  SIGINT/SIGTERM stops after the current job; a second one exits at once and kills the job's process group.
- **db.py** is the only database code: four methods, each one `select public.<fn>(...)` in its own
  transaction under `set local role service_role` with a 30 s statement timeout. Errors come back as
  `QueueRejected(code)` (the `not_found` / `conflict` / `invalid` prefix of `public.fail`) or
  `QueueUnavailable` (connection lost; reconnects on the next call).
- **sandbox.py / child.py**: each job is a fresh `python -m stash_worker.child` in its own session, with
  `RLIMIT_AS` (default 2048 MB, `STASH_WORKER_MEMORY_MB`) and no core dumps, set before exec and inherited
  by ffmpeg/fpcalc. On timeout the whole process group gets SIGKILL; it is killed again after a normal exit
  so no grandchild outlives a job.
- **runner.py**: validates the claimed row against job-payload.schema.json and every result against
  worker-result.schema.json before `worker_complete`. Outcome mapping as in the plan, plus: a job claimed
  past `maxAttempts` (only possible after stale requeues) fails for good without running; a `conflict`
  from `worker_complete` (job no longer running) is logged and left alone, since the job may now be
  another worker's. Each job gets `tempfile.mkdtemp()`, removed in `finally`.
- **jobs.py**: `HANDLERS` is empty; tickets 112+ register `"module:function"` processors. A handler
  raises `Rejected(reason, detail)` for bad files; the reason must be in workerReasonSchema (read from the
  generated schema) and cannot be `timeout` or `internal`.
- **Timeouts** from limits.json: loop, one-shot and preset -> `audio`; kit -> `kit`; MIDI -> `midi`;
  `render_vital` -> `presetRender`.

## Proof
```
$ pnpm worker:test
> stash@ worker:test /home/claude/stash/.claude/worktrees/agent-a8f08083f5c868a09
> cd apps/worker && uv run --frozen pytest -q

.....s.....................................................              [100%]
=========================== short test summary info ============================
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
58 passed, 1 skipped in 8.94s
exit 0

$ cd apps/worker && uv run --frozen ruff check . && uv run --frozen ruff format --check .
All checks passed!
17 files already formatted
exit 0

$ node scripts/licenses.mjs
All dependency licenses are on the allowed list.
exit 0
```
(The one skip is the existing fixtures/own test, which has no files yet.) The new tests, against
Postgres 16 on localhost:5432:
```
tests/test_runner_db.py::test_a_good_result_makes_the_item_ready PASSED
tests/test_runner_db.py::test_retry_backs_off_30s_then_2min_and_the_final_failure_returns_the_item_to_draft PASSED
tests/test_runner_db.py::test_a_timeout_is_retried PASSED
tests/test_runner_db.py::test_a_corrupt_file_fails_once_and_returns_to_draft_with_the_reason PASSED
tests/test_runner_db.py::test_a_result_the_database_refuses_is_retried PASSED
tests/test_runner_db.py::test_two_workers_never_claim_the_same_job PASSED
tests/test_runner_db.py::test_stale_running_jobs_are_requeued PASSED
tests/test_runner_db.py::test_the_runner_requeues_stale_jobs_before_claiming PASSED
tests/test_runner_db.py::test_the_queue_reports_function_errors_with_their_code PASSED
tests/test_runner_db.py::test_the_queue_acts_as_the_service_role PASSED
tests/test_main.py::test_settings_fall_back_to_env_local_and_the_environment_wins PASSED
tests/test_main.py::test_settings_require_a_database_url PASSED
tests/test_main.py::test_connect_params_parse_a_supabase_url PASSED
tests/test_main.py::test_the_worker_process_polls_claims_and_stops_on_sigterm PASSED
tests/test_sandbox.py::test_result_comes_back_from_the_child PASSED
tests/test_sandbox.py::test_timeout_kills_the_child_and_its_grandchildren PASSED
tests/test_sandbox.py::test_memory_cap_stops_a_runaway_handler PASSED
tests/test_sandbox.py::test_a_hard_crash_is_reported PASSED
tests/test_sandbox.py::test_an_exception_is_reported_with_its_type PASSED
tests/test_sandbox.py::test_a_rejection_carries_its_reason PASSED
tests/test_sandbox.py::test_an_unknown_handler_is_a_crash PASSED
tests/test_sandbox.py::test_rejected_accepts_only_contract_reasons PASSED
tests/test_runner.py::test_valid_result_is_completed_and_the_folder_removed PASSED
tests/test_runner.py::test_failures_map_to_worker_fail[reject_corrupt-corrupt_file-False] PASSED
tests/test_runner.py::test_failures_map_to_worker_fail[reject_unsupported-unsupported_format-False] PASSED
tests/test_runner.py::test_failures_map_to_worker_fail[crash-internal-True] PASSED
tests/test_runner.py::test_failures_map_to_worker_fail[raise_error-internal-True] PASSED
tests/test_runner.py::test_failures_map_to_worker_fail[invalid_result-internal-True] PASSED
tests/test_runner.py::test_failures_map_to_worker_fail[wrong_type_result-internal-True] PASSED
tests/test_runner.py::test_timeout_is_retryable PASSED
tests/test_runner.py::test_a_kind_with_no_handler_fails_retryably PASSED
tests/test_runner.py::test_a_job_past_its_attempts_fails_for_good_without_running PASSED
tests/test_runner.py::test_a_payload_that_breaks_the_contract_is_not_run PASSED
tests/test_runner.py::test_a_failing_complete_falls_back_to_a_retryable_fail PASSED
tests/test_runner.py::test_a_conflict_on_complete_leaves_the_job_alone PASSED
tests/test_runner.py::test_empty_queue_backs_off_up_to_the_cap_and_resets_after_a_job PASSED
tests/test_runner.py::test_database_outage_backs_off_and_keeps_running PASSED
tests/test_runner.py::test_stale_jobs_are_requeued_on_a_schedule PASSED
tests/test_runner.py::test_timeouts_come_from_limits PASSED
39 passed in 8.71s
```
Without a database (`DATABASE_ADMIN_URL` pointing at a closed port): `47 passed, 12 skipped`. With
`STASH_REQUIRE_DB=1` as well: the 11 database tests error instead of skipping. The suite ran three times
in a row with the same result; no flakes seen.

Acceptance criteria to tests:
- polls claim_job via the service role, idle backoff: `test_the_worker_process_polls_claims_and_stops_on_sigterm`,
  `test_the_queue_acts_as_the_service_role`, `test_empty_queue_backs_off_up_to_the_cap_and_resets_after_a_job`
- subprocess, timeout and memory cap, timeout/crash retryable: `test_sandbox.py`, `test_timeout_is_retryable`,
  `test_failures_map_to_worker_fail[crash…]`, `test_a_timeout_is_retried`
- corrupt or unsupported -> retryable=false with a contract reason: `test_failures_map_to_worker_fail[reject_*]`,
  `test_a_corrupt_file_fails_once_and_returns_to_draft_with_the_reason`, `test_rejected_accepts_only_contract_reasons`
- every result validated before worker_complete: `test_failures_map_to_worker_fail[invalid_result|wrong_type_result]`
- temporary folder per job, deleted: the `tmp_path` emptiness asserts in test_runner.py and test_runner_db.py
- local Postgres: backoff 30 s then 2 min and final failure to draft, single claim, stale requeue:
  the test_runner_db.py tests named above

## How CI runs the database tests
Today it does not: the `worker` job in .github/workflows/ci.yml has no Postgres, so test_runner_db.py and
the process test skip there. Request 111-worker-ci-postgres asks the lead to add a `postgres:17` service
with `DATABASE_ADMIN_URL` and `STASH_REQUIRE_DB=1`, which makes them mandatory. Each run builds its own
database (`stash_worker_test_<pid>_<random>`) from supabase/tests/shim.sql plus the migrations and drops
it at the end, so it can share a server with `pnpm db:test`.

## Not done
- **Processors** (112+), by design. Until 112 registers a loop processor, a real job is claimed and fails
  as `internal` (retryable), so `pnpm dev` uploads will end in draft after three attempts.
- **Fetching the original** (common step 1) needs a way to learn the job's item and file paths; there is
  no worker function for it (request 111-worker-job-input). The runner gives each handler its folder; the
  fetch belongs to 112 once the function exists.
- **`pnpm dev` end to end** was not run here (no Docker). Not verified: that Supabase's `postgres` user
  from `DATABASE_URL` may `set role service_role`. Supabase grants the API roles to `postgres`, as far as I
  know; if it does not, the first claim fails with a permission error in the worker log.

## Surprises and decisions
- **The ticket's "tests against a local Postgres" can't run in CI yet**: the worker job has no database (request filed).
- **pg8000, not psycopg**: psycopg is LGPL-3.0, which the licenses gate refuses. pg8000 1.31.6 (BSD-3-Clause,
  pure Python) adds scramp (MIT-0), asn1crypto (MIT), python-dateutil (BSD-3-Clause) and tzdata (Apache-2.0).
  Reason: the worker needs a Postgres client to call the four worker functions. Added with `uv add`; uv.lock committed.
- **Direct Postgres, not PostgREST RPC**: the worker connects with `DATABASE_URL` and switches to `service_role`
  per transaction, so the same code runs against the plain-Postgres test database and Supabase.
- **`requeue_stale_jobs` ignores attempts**, so a job whose worker dies every time would loop forever. The
  runner fails such a job for good when it is claimed past `maxAttempts`.
- **`worker_fail` does not check that the job is still running**, so a stalled worker could fail a run
  another worker had since claimed. The runner never calls worker_fail after a `conflict` from
  worker_complete; the database-side fix is part 2 of request 111-worker-job-input.
- **Memory limit**: the spec asks for one but limits.json has no number; 2048 MB for now (request
  111-worker-memory-limit). RLIMIT_AS caps virtual address space, so 112 should check that librosa/numba
  import under it.
- **`flagged_reason` gets only the reason code** (`internal`, `timeout`, `corrupt_file` …), which the UI turns
  into words with `WORKER_REASON_TEXT`. Details go to the worker log.
- The worktree started on the initial commit; I branched `lane/pipeline-111` from `origin/phase-0/foundations`
  as the ticket intends.

## Requests filed
All three were resolved on the base branch (decision 0012) and the request files are deleted:
- 111-worker-ci-postgres: Postgres service and `STASH_REQUIRE_DB=1` in the worker CI job.
- 111-worker-job-input: `worker_job_input(job_id, attempt)` and the attempt guard on worker_complete/worker_fail.
- 111-worker-memory-limit: `worker.memoryMb` in limits.json.

## Review round (PR #3)
Merged `origin/phase-0/foundations` (be68c66, 9c4c323) first. The sections above describe the first
round; where they disagree, this section wins.

### Base changes picked up (decision 0012)
- **Run guard.** `complete(job_id, attempt, result)` and `fail(job_id, attempt, reason, retryable)` pass the
  claimed attempt. A `conflict` from worker_job_input, worker_complete or worker_fail means another worker
  owns the run: logged, nothing else. DB test `test_a_worker_that_lost_its_job_cannot_finish_it` proves a
  worker that lost its job to a stale requeue gets `conflict` on all three calls and the new owner does not.
- **Job input.** `PgJobQueue.job_input(job_id, attempt)` calls `worker_job_input` and validates against
  worker-job-input.schema.json (`QueueContractError` otherwise); the runner validates it again for any
  queue. The handler request carries it as `JobContext.input` (item, owner, type, title, files with
  `fileName`). A job input that breaks the contract fails as `internal`, not retryable. Tests:
  `test_job_input_describes_the_claimed_job`, `test_the_handler_gets_the_job_input_through_the_runner`.
- **Memory limit** comes from `limits.worker.memoryMb` only. I dropped `STASH_WORKER_MEMORY_MB`: one source
  of numbers, and an override is one more way to lose the cap.

### Findings
1. **(blocking) Limits on the real path.** `Runner` has no uncapped mode: `memory_bytes` defaults to
   memoryMb, `run_isolated` requires an int, and timeouts are looked up per job through `timeout_for` unless
   a test overrides a kind. New tests: `test_the_memory_cap_from_limits_applies_without_an_override`
   (memory hog with no override ends `("fail", id, 1, "internal", True)`),
   `test_a_runner_without_overrides_uses_the_limits_for_every_kind` (every job kind gets `timeout_for(kind)`
   and the limits memory), `test_main_passes_the_configured_memory_cap_to_the_runner`. Checked by mutation:
   each of the three edits the reviewer named now turns the suite red (output below).
2. **Child environment.** The child gets only PATH, PYTHONPATH, LANG and LC_ALL from the worker, plus HOME and
   TMPDIR inside the job folder. `test_the_child_sees_only_an_allowlisted_environment` sets DATABASE_URL,
   SUPABASE_SERVICE_ROLE_KEY and STASH_S3_SECRET_ACCESS_KEY and checks the handler sees none of them.
   **Still needed before hostile files arrive:** run the child as a separate uid, or in its own container.
   Today it shares the worker's uid, so it could read the worker's files (including .env.local in dev) and
   signal the worker process.
3. **Untrusted outcome.json.** Opened with O_NOFOLLOW, must be a regular file, at most 1 MiB (checked with
   fstat before reading), must parse to an object. `ok` needs an object result. `rejected` needs a reason in
   `rejection_reasons()`. Anything else is a crash (`internal`, retryable). `run_once` turns any unexpected
   exception into `worker_fail('internal', true)`, and `run()` catches any Exception and carries on. The child
   also gets RLIMIT_FSIZE (kit.maxUnpackedBytes, the largest thing a job holds) and RLIMIT_NPROC. RLIMIT_NPROC
   counts every process of the uid, so the cap is the uid's current process count plus 64. It is not enforced
   for root, which is another reason for the separate uid. Tests: `test_a_forged_outcome_is_a_crash` (runner
   reason, flag reason, garbage, list result), `test_an_outcome_over_the_size_cap_is_not_read`,
   `test_the_child_runs_under_resource_limits`, `test_an_unexpected_error_never_escapes_the_loop`, and the
   forged cases in `test_failures_map_to_worker_fail`.
4. **Lazy timeouts.** Done as part of 1. `test_timeout_keys_cover_exactly_the_job_kinds` compares TIMEOUT_KEYS
   with the kind enum in job-payload.schema.json.
5. `test_the_runner_and_flag_reasons_are_contract_reasons`: "timeout" and "internal" (and the four flag
   reasons) are in `worker_reasons()`.
6. **Rejected takes file faults only.** `rejection_reasons()` = worker_reasons minus the runner reasons minus
   `FLAG_REASONS` (duplicate_exact, duplicate_fingerprint, commercial_match, pack_name_blocklist). A screening
   match must come back as `result.flag`, which makes the item flagged instead of ready (documented in
   jobs.py). Tests: `test_rejected_accepts_only_file_fault_reasons`,
   `test_a_screening_match_raised_as_a_rejection_is_a_crash`.
7. **TLS.** `connect_params` honors `sslmode` and `sslrootcert` from DATABASE_URL, mapped onto pg8000 the way
   libpq reads them:
   - This machine (localhost, 127.0.0.1, ::1): no sslmode means prefer, and `disable` turns TLS off.
   - Any other host always gets TLS. No sslmode, `allow` or `prefer` means verify-full, and `disable` is
     refused. `require` encrypts without verifying, `verify-ca` checks the chain but not the hostname.

   Tests: `test_local_hosts_use_tls_only_when_asked`, `test_remote_hosts_require_verified_tls`.
   **Deployment note:** Supabase's server certificate may not chain to the system CA store. In that case set
   `sslrootcert=<Supabase CA file>` or `sslmode=require` in DATABASE_URL.
8. `test_two_jobs_get_different_folders`: two jobs get two distinct, empty folders under the temp root, and
   both are gone afterwards.
9. **Deployment item:** production should not connect as `postgres`. Use a dedicated login role that is
   granted only `service_role` (for example `create role stash_worker login password … in role service_role`
   with `noinherit`, so it must `set role`). The worker already does `set local role service_role` per call,
   so only DATABASE_URL changes.

### Proof
```
$ STASH_REQUIRE_DB=1 pnpm worker:test
> stash@ worker:test /home/claude/stash/.claude/worktrees/agent-a8f08083f5c868a09
> cd apps/worker && uv run --frozen pytest -q

.....s.................................................................. [ 80%]
.................                                                        [100%]
=========================== short test summary info ============================
SKIPPED [1] tests/test_contracts.py:74: got empty parameter set for (path)
88 passed, 1 skipped in 12.64s

$ cd apps/worker && uv run --frozen ruff check . && uv run --frozen ruff format --check .
All checks passed!
17 files already formatted
```
Postgres 16 on localhost; CI runs the same suite on Postgres 17 with `STASH_REQUIRE_DB=1`. The one skip is
the existing fixtures/own test (no files yet).

Mutation check for finding 1. Each edit was applied alone, the suite run, and the file restored:
```
runner.py  memory_bytes=self.memory_bytes -> None              13 failed, 75 passed, 1 skipped
runner.py  timeout_s=self.timeout_for(kind) -> 120             1 failed, 87 passed, 1 skipped
__main__.py memory_bytes=settings.memory_bytes -> None         1 failed, 87 passed, 1 skipped
restored                                                       88 passed, 1 skipped
```

### Other notes
- **macOS:** the memory cap (RLIMIT_AS) is applied on Linux only. On macOS `pnpm dev` logs a warning per job
  and runs without it; production and CI run on Linux. FSIZE, NPROC and core limits apply on both.
- **PEP 538:** the child interpreter may add `LC_CTYPE` to its own environment (locale coercion). The
  environment test allows that name; the worker does not pass it in.
