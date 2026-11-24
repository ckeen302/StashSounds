# 102 createUploadSlot and completeUpload: presigned URLs, multipart, quota, job enqueue
Lane: platform
Depends on: 101

## Goal
A signed-in, verified user gets a presigned R2 URL (or multipart part URLs past the threshold), uploads straight to storage, and confirming the upload queues a processing job.

## Owned paths
apps/web/src/server/, supabase/tests/

## Spec and contracts that apply
- architecture.md: The upload pipeline, steps 1 to 3
- build-spec.md: Limits and constants (sizes, URL lifetimes, multipart), API surface
- data-model.md: create_upload_draft, add_demo_file, enqueue_processing
- contracts: createUploadSlotInput/Output, completeUploadInput/Output, limits

## Acceptance criteria
- [ ] S3 client for R2 (local: SeaweedFS from `pnpm dev`, S3 API on :9000) in apps/web/src/server/storage/
- [ ] Upload URLs expire after limits.urls.uploadTtlSeconds and cover exactly one object
- [ ] Files over limits.multipart.thresholdBytes get multipart part URLs; completeUpload completes the multipart upload
- [ ] completeUpload checks the caller owns the item, HEADs the object, then calls `enqueue_processing(user_id, item_id, file_id, measured_bytes)` with the service role (the function is not callable by signed-in users); the database refuses a size other than the declared one with `invalid`
- [ ] `create_upload_draft` and `add_demo_file` take no MIME type: the stored type comes from the extension (decision 0008)
- [ ] Preset demo slot via role 'demo'
- [ ] Tests against local storage: single upload, multipart upload, size mismatch, another user's item, quota exceeded, unverified email

## Out of scope
- Upload UI (134)
- Processing (111+)
