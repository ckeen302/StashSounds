# Request 102 Run the SeaweedFS storage tests in CI
From lane: platform
For: lead
Blocking ticket: none

## What I need changed
.github/workflows/ci.yml, in the job that runs `pnpm test`:
- Start SeaweedFS as in docker-compose.yml (`chrislusf/seaweedfs:4.53`,
  `server -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json`, host port 9000, with
  docker/seaweedfs-s3.json mounted), then create the `originals` and `previews` buckets
  (the `storage-init` step).
- Set `STASH_REQUIRE_STORAGE=1` and the `STASH_S3_*` values from .env.example.

## Why
Ticket 102 asks for tests against local storage. `apps/web/src/server/storage/seaweedfs.test.ts`
checks what the in-process stub cannot: that signatures are verified, that a body of another size
is refused by the signed Content-Length, that a URL covers only its own key, multipart with real
5 MB parts, and that originals cannot be read without a signature. It runs when the endpoint
answers. With `STASH_REQUIRE_STORAGE=1` an unreachable endpoint fails the run, which is the same
pattern as `STASH_REQUIRE_DB` for the worker.

## Workaround in the meantime
It runs locally under `pnpm dev`. In this ticket's environment it could not run: Docker Hub is
rate-limited, and running a downloaded SeaweedFS binary was refused. So the suite was skipped
here, and the handoff says so.
