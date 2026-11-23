# Request 111 A memory limit for worker jobs in limits.json
From lane: pipeline
For: lead (packages/contracts/limits.json)
Blocking ticket: none

## What I need changed
Add `worker.memoryMb` to limits.json (proposed: 2048), next to `timeoutsSeconds`. Optionally per kind,
like the timeouts, if kits or the Vital render turn out to need more.

## Why
The build spec says each job runs "with a time limit and a memory limit" but gives no number, and the
rule is that every number lives in limits.json. The runner caps each job's address space (RLIMIT_AS),
inherited by ffmpeg and fpcalc.

## Workaround in the meantime
apps/worker/src/stash_worker/config.py uses 2048 MB, overridable with `STASH_WORKER_MEMORY_MB`. When the
limit lands, the worker reads it from limits.json and the constant goes.
