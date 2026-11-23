# Handoff 103 Item reads; updateItem, publishItem, unpublishItem, deleteItem
Lane: platform
Branch: lane/platform-103 (from lane/platform-102, with origin/phase-0/foundations merged in)

## Plan

Every read goes through the caller's own client (anon or the signed-in user), so row-level
security decides what is visible. The service role is not used anywhere in this ticket.

Files (all under apps/web/src/server/items/ unless noted):
- `rows.ts`: database row types and named column lists, plus the pure builders. It is shared with 201 and 204.
  - `toItem(row, tags)` returns itemSchema.
  - `buildPlayable(item, files, samples)` returns playableSchema.
  - `itemLength`.
  - `peaksFor(files)`.
  - `checkFields(item)`.
  - `toItemRow(...)` returns itemRowSchema. Preview URLs use `previewUrl()` (NEXT_PUBLIC_PREVIEWS_BASE_URL).
- `load-rows.ts`: `loadRows(supabase, itemRows, viewerId)` batch-reads owners, preview-bucket files, the first 16 kit samples and the viewer's likes for a list of items, then builds rows. A row that cannot be built (a published item with no preview) is logged and dropped, so one bad item does not break a list.
- `get-item-page.ts`: `getItemPage(supabase, viewerId, type, param)`.
  - `parseItemParam` finds the item by public id among published items.
  - Returns `{ kind: "page", page }`, `{ kind: "redirect", href }` when the slug or the type in the URL is not the canonical one, or `{ kind: "not_found" }`.
  - The page includes all tags with their kinds, the owner with followersCount and viewerFollows, every kit sample, and moreFromOwner (up to 10). `similar` is `[]`, because 204 builds it.
- `queries.ts`: request-bound `itemPage(type, param)`. It calls Next's `permanentRedirect` and `notFound`, so pages only render the data.
- `get-own-item.ts`: `getOwnItem` (defineAction, member) returns ownItemSchema.
  - The item must be the caller's own (owner_id filter; a removed item is not_found).
  - Includes the latest job (status, attempts, plain-language error from WORKER_REASON_TEXT) and checkFields.
- `item-actions.ts`: updateItem, publishItem, unpublishItem, deleteItem (defineAction, member).
  - updateItem:
    - Updates the granted columns with the caller's client, filtered to `owner_id`. A removed or another user's item matches no row, which is not_found.
    - Tags and reference tags go through `set_item_tags`. When only one of the two lists is sent, the other list is kept from the item's current tags.
    - Changing the license away from split_on_placement clears splitPercent. Choosing split without a percent is `invalid` on splitPercent.
  - publishItem calls `publish_item`. rightsConfirmed is required by the contract. Flagged or other non-ready items get `conflict` from the database.
  - unpublishItem calls `unpublish_item`.
  - deleteItem checks ownership with the caller's client first, so an admin's own deleteItem never takes the admin path in `remove_item` (moderation is adminReview, ticket 2xx), and then calls `remove_item`.
- `actions.ts` ("use server") and exports from `server/index.ts`.

Tests first:
- `items/rows.test.ts`: playable for each type, length, peaks, check fields, row and item parsing.
- `items/items.test.ts`:
  - getItemPage: page, redirect, not found, viewer state.
  - getOwnItem.
  - Each action for the owner, another user and a wrong status, all on the fake client.
  - A test that the service client is never touched.
- `supabase/tests/items.test.ts`: what the reads and actions rely on in the database.
  - Anon and another user see a published item, its preview files, samples and tags, but never a draft, never originals and never jobs.
  - The owner sees their draft and its job.
  - Column updates go through items_update (another user's item and a removed one match nothing; ungranted columns are refused).
  - set_item_tags keeps tag kinds.
  - publish_item refuses flagged, draft and a missing rights confirmation.
  - Unpublish and remove for the owner, another user and a wrong status.

Gaps filed as requests. The provisional choice for each is in the request, kept in one function so the answer is a one-line change:
- `docs/requests/103-row-sources.md`:
  - Where a row's peaks come from: provisional, `meta.peaks` on the `peaks` file.
  - The MIDI default `sound`: provisional, from details.kind.
  - Which file is a preset's demo preview: provisional, the `preview` file.
- `docs/requests/103-check-fields.md`:
  - No key-confidence threshold in limits.
  - The uploader's corrections cannot be recorded, so "check this" keeps showing after an edit.
- `docs/requests/103-delete-cleanup.md`: "Delete … schedules file cleanup", but there is no cleanup job kind.
- `docs/requests/103-slug-on-rename.md`: the slug is not updated when the title changes, because slug is not a granted column.

## What changed

All the new code is in apps/web/src/server/items/, plus a test-data helper in testing/items.ts.

**Row builders and readers**
- `rows.ts`: pure builders.
  - `toItem` produces itemSchema. A numeric bpm is accepted as a string too, and the key is built from key_root and key_mode.
  - `buildPlayable` builds the playable for each type, from previews-bucket files only:
    - loop: `preview`, details.loopSamples and details.sampleRate.
    - oneshot: `preview` and details.rootNote.
    - kit: the first 16 samples by position.
    - midi: the `notes` file, bpm (120 when there is none) and `MIDI_SOUND[details.kind]`.
    - preset: `preview` as demoUrl, and `sampled_note` files with `meta.pitch`.
  - `itemLength` and `peaksFor` (meta.peaks, checked with peaksSchema).
  - `checkFields`, `toKitSample` and `toItemRow`.
  - Column lists are named; `*` is never used.
- `load-rows.ts`:
  - `loadRows(supabase, items, viewerId)` builds rows for a list with one query per table, not one per row. A row that cannot be built is logged and dropped. 201 and 204 can reuse it.
  - `readTags` reads tags with their kinds.

**Queries and actions**
- `get-item-page.ts`: `getItemPage(supabase, viewerId, type, param)` returns `page | redirect | not_found`.
  - It uses `parseItemParam`, then looks the item up by public id among published items.
  - When the type or slug is not canonical, the result is a redirect to `itemHref`.
  - The page includes the owner with followersCount and viewerFollows, `allTags` with kinds, `licenseVersion` from LICENSES, every kit sample, moreFromOwner (up to 10, newest first), and `similar: []`.
  - A published item that cannot be played throws, because that is a pipeline bug.
- `queries.ts`: `itemPage(type, param)` for the page (ticket 135). It calls `permanentRedirect(href)` and `notFound()`, and is marked server-only.
- `get-own-item.ts`: `getOwnItem({ itemId })` (member).
  - Reads with an owner_id filter, so an admin's own call does not reach other people's items. A removed item is not_found.
  - Includes the latest job. Its error is shown as WORKER_REASON_TEXT for a known reason code, and the `internal` text otherwise, so a raw error is never shown.
  - Includes checkFields.
- `item-actions.ts`: updateItem, publishItem, unpublishItem, deleteItem.
  - updateItem:
    - Writes only granted columns, filtered to the owner. A row hidden by policy gives PGRST116, which maps to not_found.
    - Tags go through `set_item_tags`, and the set not being edited is sent back unchanged.
    - License and split: leaving split clears the share; choosing split without a share is `invalid` on splitPercent; a share with another license is `invalid`.
  - publishItem calls `publish_item(rightsConfirmed, wavetablesConfirmed)` and parses the row it returns into `{ itemId, publishedAt, href }`.
  - unpublishItem calls `unpublish_item`.
  - deleteItem checks ownership as the caller first, then calls `remove_item`.
- `actions.ts` ("use server") wraps all five. `server/index.ts` exports them, plus `itemPage` and `loadRows`.

**Reads run as the caller**
None of these functions touch the service role. The unit tests run every action with deps that have no service client and no storage, so any use of either would throw.

**Test helper**
testing/fake-supabase.ts gained `neq`, `in`, `lt`, `order` and `limit`, recorded in `QueryCall.ops`.

## Proof
`pnpm check && pnpm test && pnpm db:test`, exit 0:
```
apps/web typecheck: Done
 Test Files  14 passed | 1 skipped (15)
      Tests  283 passed | 7 skipped (290)
 Test Files  4 passed (4)
      Tests  126 passed (126)
```

**New tests**
- items/rows.test.ts (18 tests):
  - the playable for each type, including that an original is never played;
  - length, peaks and check fields;
  - a row for every type, parsed with itemRowSchema;
  - the viewer field, the tag cap, and that unpublished or unplayable items give no row.
- items/items.test.ts (29 tests):
  - getItemPage: page, signed-in viewer, redirect on a wrong slug, type or missing slug, not_found (including the owner's own draft), the kit samples list, and that only published items and previews-bucket files are read.
  - getOwnItem.
  - For each action: the owner, another user and the wrong status. deleteItem is also tested for an admin calling it on someone else's item and for a suspended member.
- supabase/tests/items.test.ts (20 tests). These run as anon, the owner, another user and an admin, using the same queries the server makes:
  - Published items, previews, samples, tags and profiles are readable.
  - Originals and kit original_path are never readable.
  - Draft, ready, flagged and removed items are hidden.
  - Jobs are hidden from anyone but the owner.
  - The update grant: other users and removed items match no row; ungranted columns are refused; license and split must agree.
  - set_item_tags kinds.
  - The publish, unpublish and remove status rules.
- The SeaweedFS suite is still skipped here (7 tests). See 102.

## Not done
- Item page caching and revalidation: build spec says "refreshed when the item changes". No `revalidatePath` is called yet; ticket 135 decides how the page is cached.
- `similar` is `[]` (ticket 204). Search and browse are ticket 201, which can reuse `loadRows`.
- File cleanup on delete: request 103-delete-cleanup.
- A rate limit on edits: ticket 203.

## Surprises and decisions
- An owner can edit an item in any status but removed, including flagged and processing, because that is what items_update allows. The worker keeps an uploader-set bpm and key (`coalesce` in worker_complete).
- A preset's demo for playback is its derived `preview` file, never the uploader's original demo, which is in the private bucket.
- `checkFields` also treats a MIDI file's own tempo (`midi_file`) as trusted.
- The page redirects on a wrong type as well as a wrong slug. Only the public id identifies the item.

## Requests filed
- docs/requests/103-row-sources.md: where peaks come from, the default MIDI sound, the preset demo file.
- docs/requests/103-check-fields.md: the key-confidence threshold, and recording the uploader's corrections.
- docs/requests/103-delete-cleanup.md: there is no cleanup job.
- docs/requests/103-slug-on-rename.md: the slug does not follow a title change.

## 102 review fixes merged in
lane/platform-102 df6c0c0..08e9c5a (staging key, B1, and the advisory items) was merged into this branch at e28b7d9. See the 102 handoff's Review round section.
