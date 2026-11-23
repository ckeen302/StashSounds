# Request 103 deleteItem "schedules file cleanup", but there is no cleanup job
From lane: platform
For: lead (and Pipeline)
Blocking ticket: none

## What I need changed
build-spec says: "Delete marks removed and schedules file cleanup; download records are kept." remove_item's comment says "File cleanup is a worker job". However, processing_jobs.kind has no cleanup kind, and nothing queues one.

Proposed: a `cleanup_item` job kind.
- remove_item queues it, so admin removals are cleaned up too.
- The worker deletes the item's previews and originals.
- The worker releases the item's share of accounts.storage_bytes.

## Provisional choice in 103
deleteItem calls remove_item and returns `{ status: "removed" }`. The files stay in storage. A removed item's previews are no longer readable through item_files (can_read_item), but their public URLs keep working until cleanup exists.
