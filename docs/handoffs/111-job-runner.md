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
