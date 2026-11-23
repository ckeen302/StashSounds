# 111 Job runner: claim, time and memory limits, retries, status updates
Lane: pipeline
Depends on: 004

## Goal
The worker claims jobs one at a time, runs each in a subprocess with time and memory limits, and records success or failure with retries and backoff.

## Owned paths
apps/worker/

## Spec and contracts that apply
- build-spec.md: Worker jobs (common steps), Failure handling, Limits (worker timeouts, attempts, backoff)
- data-model.md: processing_jobs, claim_job, worker_complete, worker_fail, requeue_stale_jobs
- contracts (generated JSON Schema): job-payload, worker-result

## Acceptance criteria
- [ ] `python -m stash_worker` polls claim_job via the service role; idle backoff when the queue is empty
- [ ] Each job runs in a subprocess with the type's timeout and a memory cap; timeout and crash call worker_fail(retryable=true)
- [ ] Corrupt or unsupported files call worker_fail(retryable=false) with a reason from workerReasonSchema
- [ ] Every result is validated against worker-result.schema.json before worker_complete
- [ ] Temporary folder per job, deleted when the job ends
- [ ] Tests against a local Postgres: retry with backoff 30 s then 2 min, final failure returns the item to draft, two workers never claim the same job, stale running jobs are requeued

## Out of scope
- The processors themselves (112+)
