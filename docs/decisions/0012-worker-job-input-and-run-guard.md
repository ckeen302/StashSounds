# 0012 Worker job input, run guard and memory limit (requests from ticket 111)
- Context: The Pipeline lane filed three requests while building the job runner: Postgres for the worker CI job, a way to learn what a claimed job processes, a guard so a stalled worker cannot finish another worker's run, and a memory number in limits.json.
- Choice:
  - `worker_job_input(job_id, attempt)` returns `workerJobInputSchema` (contracts/src/worker.ts, generated to worker-job-input.schema.json): the item, its owner and type, and its uploaded originals and demo with each file's original name.
  - `create_upload_draft` and `add_demo_file` take an optional file name, kept as `item_files.meta.fileName`, so ticket 113 can read BPM and key from it.
  - `worker_complete(job_id, attempt, result)` and `worker_fail(job_id, attempt, reason, retryable)` refuse with `conflict` unless the job is running for that attempt (`worker_run`). Claiming increments attempts, so a run taken over after a stale requeue is fenced off.
  - `limits.worker.memoryMb = 2048`.
  - The worker CI job has a Postgres 17 service and `STASH_REQUIRE_DB=1`, so the runner's database tests cannot skip in CI.
- Consequence: The Pipeline lane updates its calls to the new signatures and reads memoryMb from limits.json (ticket 112 starts with that). Ticket 114's lookups (SHA-256 owners, fingerprints by duration) come as narrow functions of the same kind.

## Also from ticket 101's requests
- Sign-in schemas (`signInWithEmail*`, `signInWithProvider*`, `signOut*`, `nextPathSchema`) are in contracts/src/api.ts; Platform deletes its local copy.
- `apps/web/src/proxy.ts` belongs to the Platform lane (CLAUDE.md, lint); Platform creates it.
- Auth redirect URLs cover the callback on ports 3000 and 3100.
- `profiles_update` requires an active (not suspended) account.
