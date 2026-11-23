# Handoff 102 createUploadSlot and completeUpload: presigned URLs, multipart, quota, job enqueue

## Plan
Branch `lane/platform-102` from `origin/lane/platform-101`, with `origin/phase-0/foundations` merged in.

Files (apps/web/src/server/ unless noted):
- `storage/env.ts`: Zod schema for `STASH_S3_*` and `STASH_BUCKET_ORIGINALS` (server only, already in .env.example).
- `storage/originals.ts`: an `OriginalsStorage` built on `@aws-sdk/client-s3`. It presigns one PUT for
  one key with `Content-Length` signed, so the URL accepts only that object at the declared size,
  for `limits.urls.uploadTtlSeconds`. For multipart it creates the upload, presigns one URL per part
  with that part's exact length, then completes or aborts the upload. It can also HEAD and delete an
  object. The client uses `requestChecksumCalculation: "WHEN_REQUIRED"`. The SDK's default adds a
  CRC32 of an empty body to presigned PUTs, which breaks browser uploads (checked against the
  installed 3.1165.0).
- `supabase/service.ts`: service-role client from `SUPABASE_SERVICE_ROLE_KEY`, server only. It is
  used only for `enqueue_processing` and for storing the multipart upload id in `item_files.meta`.
- `uploads/create-upload-slot.ts`, `uploads/complete-upload.ts`: the actions (auth `member`).
  - createUploadSlot takes the extension and title from `fileName` and ignores the client's `mime`.
    For `original` it calls `create_upload_draft`; for `demo` it needs `itemId` and type `preset`
    and calls `add_demo_file`. Both run as the user, so the database checks quota, verified email
    and suspension. Above `limits.multipart.thresholdBytes` it returns part URLs.
  - completeUpload reads the item and file as the caller (only the owner's rows), completes the
    multipart upload when there is one, HEADs the object, then calls `enqueue_processing` with
    the service role and the measured size. On a size mismatch it deletes the object, so nothing
    is stored that the worker will not process, and returns `invalid`.
- `ActionDeps` gains optional `service` and `storage` factories, so tests inject fakes.
- Tests: action unit tests with fake storage and a fake Supabase client covering single, multipart,
  size mismatch, another user's item, quota exceeded, unverified email, demo slot, the MIME being
  ignored, and the object missing. There are also storage unit tests against an in-process S3 stub
  (presigned URL expiry, key, signed length, part sizes; the create, complete, HEAD and delete wire
  calls), plus a SeaweedFS suite that runs when `STASH_S3_ENDPOINT` answers.
  `supabase/tests/uploads.test.ts` covers the database gaps: add_demo_file rules, demo replacement
  and quota, enqueue for another user's item, a repeat enqueue, and a preset waiting for its demo.

Ticket problems found while planning:
- `completeUploadOutput` requires `status: "processing"` and a `jobId`. `enqueue_processing`
  returns null while a preset still waits for its demo (or the demo for its original). Filed
  docs/requests/102-complete-upload-waiting.md, and widened the output locally from contracts pieces.
- "Tests against local storage": SeaweedFS cannot run here (Docker Hub is rate-limited, and running
  a downloaded binary was refused), so the SeaweedFS suite is written but did not run in this
  environment. CI's unit job has no storage service; filed docs/requests/102-storage-in-ci.md.
