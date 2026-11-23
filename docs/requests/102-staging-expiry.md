# Request 102 Expire leftover staging uploads in the originals bucket
From lane: platform
For: lead (docker-compose.yml, production bucket setup)
Blocking ticket: none

## What I need changed
After the PR #6 B1 fix, every upload goes to `staging/<owner>/<item>/<file>` in the originals bucket. completeUpload copies the staged object and deletes it. Objects are still left under `staging/` in three cases:
- an upload that is never completed;
- a late PUT to a URL that is still valid after completeUpload;
- a multipart upload that is never completed or aborted.

Nothing reads `staging/`, but these objects take space.

Proposed:
- **R2 (production):** add a lifecycle rule on the originals bucket for the prefix `staging/` that deletes objects one day after creation and aborts incomplete multipart uploads after one day.
- **Locally:** no rule is needed. Optionally, `s3.configure` or a TTL on the SeaweedFS staging path.

## Why
Orphaned staged objects are invisible to users and to the worker, but they would otherwise stay in the bucket forever. accounts.storage_bytes counts declared sizes from the database, not staged objects, so quotas are not affected.

## Workaround in the meantime
None needed for correctness. The objects simply stay.
