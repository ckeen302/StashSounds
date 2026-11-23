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
