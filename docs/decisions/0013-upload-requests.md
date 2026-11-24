# 0013 Requests from ticket 102: waiting presets, storage in CI, CORS, suspended uploads
Date: 2026-11-23. Decided by: lead.

## completeUploadOutput for a preset waiting on its other file
Accepted as proposed. `completeUploadOutput` is a union on `status`: `processing` with a `jobId`,
or `draft` with `jobId: null` and `waitingFor: "original" | "demo"`. Confirming a preset's
original before its demo is the normal order, not an error. Platform deletes its local schema.

## SeaweedFS in CI
Accepted. The "Types, lint and unit tests" job starts the compose `storage` service and
`storage-init`, loads the `STASH_S3_*` and `STASH_BUCKET_*` values from .env.example, and runs
`pnpm test` with `STASH_REQUIRE_STORAGE=1`, so the signed-URL suite can no longer skip in CI.

## CORS for browser uploads
- Local: SeaweedFS runs with `-s3.allowedOrigins=http://localhost:3000,http://localhost:3100`.
  SeaweedFS 4.53 answers an allowed origin with all methods and headers allowed and exposed
  (ETag included) and refuses other origins with 403 (weed/s3api/s3api_server.go,
  handleCORSOriginValidation).
- Production: the originals bucket on R2 gets docs/deploy/r2-originals-cors.json with the real site origin:
  PUT only, `content-type` allowed, `ETag` exposed, max age 3600. Exact origins, no wildcards.

## Suspended accounts finishing an upload
Accepted, tightening only. `add_demo_file` refuses a caller that is not an active user, and
`enqueue_processing` refuses when `p_user_id` is suspended; both fail with `forbidden`. Policy test
in supabase/tests/policies.test.ts.

## Not decided here
Cleaning up abandoned drafts and unfinished multipart uploads (they count toward quota), and part
URL lifetime for slow 500 MB kit uploads: added to the board as follow-ups.
