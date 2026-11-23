# Request 111 Worker functions: job input, and a guard on who may finish a run
From lane: pipeline
For: lead (supabase/migrations, packages/contracts)
Blocking ticket: 112 (part 1); none (part 2)

## What I need changed
1. A service-role function that returns what a claimed job needs to process, for example
   `public.worker_job_input(p_job_id uuid) returns jsonb`, only for a job that is `running`:
   `{ itemId, ownerId, type, files: [{ id, role, bucket, path, bytes, mime, sha256 }] }` for the item's
   uploaded originals (role original or demo), plus the original file name if one is kept (113 parses
   BPM and key from it). A matching `workerJobInputSchema` in packages/contracts/src/worker.ts, generated
   to worker-job-input.schema.json, so the worker validates it like the payload and result.
   Ticket 114 will need a similar narrow call for "does another user own an original with this SHA-256"
   and for fingerprints of similar duration; that can come with 114.
2. A run guard: `worker_complete` and `worker_fail` take the attempt number the worker claimed
   (`p_attempt int`) and refuse with `conflict` when `processing_jobs.attempts` differs or the job is not
   running.

## Why
1. claim_job returns only the processing_jobs row. The worker may use nothing but the service role's
   worker functions, so it has no way to learn the item's type, owner or original's storage path, and
   step 1 of every job (fetch the original) cannot be written.
2. worker_fail does not check that the job is still running or still this worker's run. A worker that
   stalls past the stale threshold, whose job was requeued and claimed by another worker, can then fail
   (or requeue with backoff) the other worker's run. The runner already avoids calling worker_fail after
   a `conflict` from worker_complete, but a guard in the database is the real fix.

## Workaround in the meantime
1. None for 112; the job runner (111) does not need it. 2. The stale threshold is the longest job
   timeout plus 60 s and the runner kills a job's process group at its timeout, so the window is small.
