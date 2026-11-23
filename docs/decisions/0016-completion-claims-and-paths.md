# 0016 Completion claims, same-site paths, unique part numbers
Date: 2026-11-23. Decided by: lead. Source: PR #6 security re-review (S1, S3, S5), PR #9 review (A3).

## A file is completed once (PR #6 S1, S2)
completeUpload must call `claim_file_completion(p_user_id, p_item_id, p_file_id, p_token)` before
it touches storage. The function locks the item row, answers not_found unless the caller owns it
and conflict unless the item is a draft, and records `meta.completing` (the token) and
`meta.completingAt` on the file row. It returns false when the file is already confirmed
(`uploaded_at` set) or another live claim exists (younger than `limits.urls.uploadTtlSeconds`).
On false, completeUpload copies nothing. On any early exit it calls
`release_file_completion(p_file_id, p_token)`. `enqueue_processing` clears the claim when it
confirms the file. Both functions are service role only.

## Status before anything else (PR #6 S3)
`enqueue_processing` checks `status = 'draft'` right after the owner check, so a refused
completion never reaches cleanup that would delete the worker's object.

## Same-site paths (PR #9 A3)
`sameSitePathSchema` in common.ts is the one rule for hrefs: item rows, publishItemOutput and
notification items all use it.

## Unique part numbers (PR #6 S5)
`completeUploadInput.parts` refuses duplicate part numbers, so the storage call never sees them.

## Not yet (PR #9 A5)
Kit pads (16) and more-from-owner (10) stay as contract `.max()` values for now; the lane may read
them from the schemas. They move to limits.json if a second place needs them.

## Previews bucket CORS (PR #10 review)
Playback fetches previews with `fetch()` and decodes them, so the previews bucket needs a GET rule
for the site origin: docs/deploy/r2-previews-cors.json. The originals rule (PUT only) is renamed
docs/deploy/r2-originals-cors.json. The embed build (321) will add its own origins here.

## Client cache sizes stay in the audio package (PR #10 A5)
The loader's 96 MB decoded budget and 32 raw downloads are client tuning, not product limits, and
stay as constructor defaults in packages/audio.

## Downloads (ticket 104 questions)
- An owner's own download is recorded (it is still a license record) but does not raise
  `downloads_count`.
- A record written before signing fails stays. The license record is the grant, and the person can
  press download again; a retry inside the rate window counts against downloadsPerDay, which is
  acceptable at 1 per press.

## Claims are fenced (PR #6 second re-review, A1 and A3)
A claim lapses after `limits.urls.uploadTtlSeconds` so a crashed call cannot lock the owner out, but
a call that only stalled must not act after another call took the claim over. So:
- `enqueue_processing(p_user_id, p_item_id, p_file_id, p_measured_bytes, p_token)` confirms the
  file only while `p_token` still holds the claim and `uploaded_at` is null; otherwise conflict,
  and a conflict makes completeUpload delete nothing.
- `file_claim_held(p_file_id, p_token)` is checked immediately before the copy; false means copy
  nothing and return conflict.
- `mark_file_copied(p_file_id, p_token)` sets `meta.copiedAt` in one statement under the claim
  (replaces the read-then-write in completeUpload).
- The copy itself cannot be fenced, so the web host's maximum request duration must stay well
  under `uploadTtlSeconds` (900 s). Vercel functions stop at 300 s by default; do not raise it
  past 600 s. Recorded in docs/deploy/README.md.
