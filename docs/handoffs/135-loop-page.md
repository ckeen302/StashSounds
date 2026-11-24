# Handoff 135 Loop item page: waveform, tempo and key controls, download

## Plan (proceeding on the lead's go-ahead: stays within the ticket and the Interface paths)
Branch `lane/interface-135` from `lane/interface-132`, with `lane/platform-104`, `lane/audio-123` and
`phase-0/foundations` merged in. Ticket 137 (browser-only demo) follows, so the page reads its data
through one thin loader and takes its actions through one adapter, and 137 can feed both without
forking a component.

1. **Route** `apps/web/src/app/[type]/[item]/page.tsx` (the build spec's `/[type]/[slug]-[id]`; Next
   cannot split one segment, so `[item]` is the `slug-publicId` segment that `itemPage` parses).
   - Server component. `generateMetadata` and the page call the same cached loader, so the data is
     read once per request.
   - Metadata: title, description from the item (type, bars, BPM, key, uploader, license), canonical
     URL, Open Graph (`music.song`, site name, URL) and a Twitter `summary` card. Built by a pure
     function with a unit test. The share image route (`/og/[id]`) is not built yet; when it lands,
     the card becomes `summary_large_image` in one line.
2. **The loader** `app/[type]/[item]/load.ts`: `loadItemView(type, param)` returns
   `{ page: ItemPage, viewer: { signedIn }, source: "server" | "local" }`.
   - Normally it is `itemPage()` from `@/server` (redirects and not-found stay there).
   - With `STASH_DEV_PAGES=1` only, a fixture id (the gallery's five loops) is answered from
     `_item/fixtures.ts`, parsed with `itemPageSchema`, so the e2e tests have a real server-rendered
     page with no database. A `stash-dev-viewer=member` cookie makes the fixture viewer signed in.
     Wrong slug or type redirects to the canonical href, like the real query. Production never takes
     this branch (unit test).
3. **Actions adapter** `_item/actions.ts` (client): `{ download, like, follow }`.
   - `server`: `download` is `requestDownload` from `@/server/downloads/actions`. `toggleLike` and
     `toggleFollow` do not exist yet (ticket 301), so like and follow show their state and counts,
     open the sign-in prompt when signed out, and say plainly that they are not switched on yet when
     signed in.
   - `local`: like and follow toggle in memory, download returns the fixture file with the item's
     license. The e2e uses it; 137 reuses it for the demo.
4. **The page** `_item/item-view.tsx` (client), design spec Item page:
   - Desktop: two columns. Left (two thirds): type chip, title (Display), uploader line, then the
     hero player: 64 px pad play button and the hero waveform, then the transport.
     Right: full uploader card with follow; license plate with the one-line summary; Download
     (primary, the one lit action) and Like; then the metadata list (BPM, KEY, BARS, LEN, GENRE,
     published, likes, downloads). Below both: tags, the description, more from this uploader as rows.
   - Phone: one column in the same order, with Download pinned above the mini player.
   - Instant play: the preview is preloaded on mount (fetch only; nothing sounds without a gesture),
     and the engine is unlocked on the first pointer or key press. Space plays and pauses anywhere on
     the page.
   - Waveform: drawn from the stored peaks at once (server-rendered canvas size, so no layout shift);
     the hero reads `getPositionMs()` per frame for its playhead and the time above it; click, drag
     and arrows seek; bar ticks from the loop length.
   - Keys (build spec, shared behaviour): Space, Left and Right (scrub), `[` and `]` (key), `-` and
     `=` (tempo), L (like), D (download). Ignored while typing in a field. Pure key map, unit-tested.
     The global keyboard map is still 225.
   - Download: signed out opens the sign-in dialog (back to this page after sign-in); signed in calls
     `requestDownload`, starts the file, and shows the license record (license, version, file name)
     in the license panel and a toast. Errors are a toast with the contract's message.
   - Share: copy link, with a toast.
5. **packages/ui:**
   - `Stepper` (key shift in semitones): minus, readout, plus; at limit; focus. Arrow keys.
   - `Transport`: tempo (slider plus BPM readout plus reset), key (stepper with the resulting key
     name), loop (toggle), volume (mute plus slider). A section without a handler is disabled, which
     covers types that lack a control. Engraved labels.
   - `Waveform`: with a clock reader, the hero now also writes the playhead time above the line per
     frame (it showed none before).
   - Icons: Minus, Repeat, RotateCcw.
   - Gallery sections for Stepper and Transport in every state; `e2e/gallery-sections.ts` lists them.
6. **Binding to the engine** `_item/use-item-player.ts`: tempo (`setTempo`, readout from
   `tempoRatio`), key (`setTranspose`, readout from `transpose`), volume (`setVolume`, remembered with
   the shell's `volume.ts`), and loop. The engine has no loop switch, so loop off is done on the
   page: the frame loop that draws the playhead sees the wrap and pauses at the start. A request
   asks the Audio lane for `setLoop` so it is sample-exact (docs/requests/135-engine-loop-switch.md).
7. **Tests first:**
   - Unit (web): metadata builder, key map, loop-off wrap detection, the loader's production and
     dev branches, the local actions.
   - Unit (ui): Stepper and Transport markup and limits, transposed key names, tempo range.
   - e2e `e2e/journeys/loop-page.spec.ts` (fixture loader, `page.route` for audio as in shell.spec):
     server-rendered HTML with metadata and preview card; canvas drawn from peaks while the audio
     request is held; Space plays; tempo and key change live while it keeps playing; loop and volume;
     signed-out download opens sign-in; signed-in download saves a file and shows the license; like
     and follow; more from the owner plays and queues; redirect and 404; phone layout with pinned
     download; axe scan.
   - Perf `e2e/perf/budgets.spec.ts` points at the loop page: LCP under 2.0 s and CLS under 0.05 with
     CPU 4x and a 4G-class network, and a first-sound check from the Space key under 300 ms.
8. Lane check `pnpm check && pnpm e2e` (STASH_E2E_PORT=3135), plus `pnpm test` and the budgets spec.
   `pnpm visual` needs Docker, which this machine lacks; CI runs it, and the new baselines are
   generated there.

Out of scope: similar items (204), the share image route, the global keyboard map (225), like and
follow server actions (301).

## What changed
Branch `lane/interface-135`. Built on lane/interface-132 with platform-104, audio-123 and
foundations merged in, then foundations (c775765) and the 132 design review round
(origin/lane/interface-132) merged again before pushing. The 132 round's files (result-row actions,
skip link, tablet progress, tap targets, slider track) are untouched here; the only overlap was
`components.css`, where both sides added `@custom-variant`s and both are kept.

**Script budget round (lead heads-up after the first push).** Foundations 5a05d1e (the zod-free
`@stash/contracts/format`) and 132's 021e25e (player details on first play) are merged, then
foundations e93d584 and 132's 49070d2 again before this push. One conflict: `result-row.tsx`
imports, where this branch's lazy menus are kept over 132's eager import. That file is 132's, and it
is touched only because the loop page's "More from" rows had to come under the budget.
- Every client module on the loop page imports `@stash/contracts/format` (formatKey, decodePeaks,
  LICENSE_LABELS) and `limits.json`, never `@stash/contracts` for values; schema parsing stays on the
  server (`fixtures.ts`, `load-core.ts`, `meta.ts`). No zod in any chunk the page loads (checked).
- `ResultRow` loads Radix Menu and ContextMenu (about 17 KB gzip) only for rows that have entries;
  a row without entries shows a disabled plain button, as before.
- The sign-in dialog (`_item/sign-in-dialog.tsx`) and the local actions
  (`_item/lazy-local-actions.ts`) load on first use. Nothing needs them before a click.
- `Avatar` no longer uses Radix: a plain `img` over the initials, server-rendered, initials kept if
  the picture fails. One `eslint-disable-next-line @next/next/no-img-element` with its reason:
  packages/ui does not depend on Next, and Radix rendered the same plain `img`.
- `e2e/perf/budgets.spec.ts` summed script sizes inside the `requestfinished` handler, which raced
  the assertion and under-counted (the 160 KB in the first handoff was wrong). It now awaits every
  size before the sum. Measured honestly the loop page was 250 KB, 213 KB after the format switch,
  205 KB after the lazy menus and dialog, and is **199 KB** now (budget 200 KiB = 204,800 bytes).
- Where the bytes are: `/` alone is 184 KB (the shell: React, Next, Radix tooltip, slider and toast,
  the engine). The loop page adds about 15.5 KB of its own (ItemView 5.9 KB, transport, stepper,
  waveform, rows and uploader card 9.2 KB). Headroom is about 1 KB, so any growth in the shell will
  push item pages over; that is the lead's and 132's call, not something this page can absorb.

**Route and data**
- `apps/web/src/app/[type]/[item]/page.tsx`: the item page, server-rendered and dynamic per
  request (like, follow and download depend on the viewer). `generateMetadata` and the page share
  one cached loader call.
- `_item/load.ts` + `_item/load-core.ts`: the thin loader. Production: `itemPage()` and
  `getSession()` from `@/server`, nothing else. With `STASH_DEV_PAGES=1` only, the five gallery
  fixture loops are answered from `_item/fixtures.ts` (parsed with `itemPageSchema`), with the same
  redirect and not-found rules as the real query. Ticket 137 adds its static demo source here.
- `_item/meta.ts`: title "Dusty soul chops by Kilo Beats", a producer-language description, canonical
  URL, Open Graph (`music.song`, site name, URL) and a Twitter `summary` card.

**Actions adapter** (`_item/actions.ts`)
- One `ItemActions` shape: `download(itemId)`, optional `like`, optional `follow`, and how the file is
  saved. Shapes are `z.output` of the contract's `requestDownloadOutput`, `toggleLikeOutput` and
  `toggleFollowOutput`.
- `server-actions.ts`: `requestDownload` from `@/server/downloads/actions`; the signed URL is an
  attachment, so it saves without leaving the page. No like or follow yet (ticket 301): signed-in
  visitors get a plain "not switched on yet" toast.
- `local-actions.ts`: fixtures and the 137 demo. Like and follow toggle in memory with correct
  counts; download returns the item's (or a row's) preview with its license and current version,
  saved through a blob.

**The page** (`_item/item-view.tsx`, `_item/use-item-player.ts`)
- Desktop two columns, phone one column in the spec's order. The layout follows its own column
  through container queries (`cq-md`, `cq-lg`, `cq-xl` in components.css), so the collapsible rail
  and the 1024 window both get a layout that fits: at 1024 the right column moves under the player
  and its panels sit two across.
- Hero: 64 px pad play button and the hero waveform, drawn from the stored peaks at once. It reads
  the engine clock per frame for the playhead, the time above it (new in `Waveform`, written straight
  to the element) and `aria-valuenow`. Click, drag and arrows seek; bar ticks come from the loop length.
- Instant play: the preview is preloaded on mount, the audio context is created on the first
  pointer or key press, and Space plays from anywhere on the page. Measured first sound after Space:
  155 to 172 ms.
- Transport bound to the engine. Tempo calls `setTempo`, key calls `setTranspose`, and both readouts
  come back from `tempoRatio` and `transpose`. Before play, tempo and key are held and applied the
  moment it starts. Volume uses `setVolume` with the shell's remembered volume (`rememberVolume`,
  `readUnmuteVolume`), so the page and the player bar agree. Loop off is a page-side stand-in (below).
- Keys: Space, Left and Right, `[` `]`, `-` `=`, L, D. Ignored while typing, with modifiers, and
  where a focused control owns the key.
- Download: signed out opens "Sign in to download" and goes to `/login?next=<page>?then=download`.
  Back on the page, signed in, `?then=` finishes the download, like or follow once and is removed
  from the address. Signed in: the file saves, the license panel shows the record (license, version,
  file name), and a toast repeats it with the summary.
- Like and follow: optimistic with rollback. Signed out, they ask to sign in.
- More from this uploader: result rows that play in place; the list becomes the queue, so the
  player bar's Next walks it. Row like and download use the same adapter.
- Copy link (share), the type chip, the published date, tags and "In the style of" reference tags.
  The metadata list shows BPM, KEY, BARS, LEN, LIKES, DOWNLOADS and GENRE.
- Phone: Download and Like pinned above the mini player (sticky at the end of the scrolling
  content, so no fixed offsets).

**packages/ui**
- `Stepper` (key shift): at-limit, focus, disabled; arrow keys; the readout is announced.
- `Transport`: tempo slider with a BPM readout (half to double speed, inside `limits.bpm`), key with
  the resulting key name, a reset, a loop switch, and mute with volume. A section without a handler is
  disabled. It has engraved labels with key hints on desktop and lays itself out by its own width.
- `transport-math.ts`: `transposedKey`, `semitoneText` (the true minus sign), `tempoRange`, `keyShiftText`.
- `Waveform`: the hero with a clock reader now shows the playhead time.
- Icons Minus, Repeat, RotateCcw. Gallery sections `c-stepper` and `c-transport`, in every state.

**Also**
- `/licenses`: the three licenses in plain language with versions; the license badge's anchors land
  on them.
- `/u/[handle]`: a placeholder, so the uploader links do not full-load a 404 and stop the player.
- `e2e/perf/budgets.spec.ts` now also covers the loop page (CPU 4x on 4G) and first sound after Space.
- `e2e/visual/screens.spec.ts`: the loop page at the three widths (baselines still to generate).

### Acceptance criteria
| Criterion | Proof |
| --- | --- |
| Server-rendered with correct metadata and preview card | e2e "the page is server-rendered with its metadata and preview card" reads the raw HTML: h1, title, description, canonical, og:*, twitter:card, owner, license, more-from rows. Redirect and 404 e2e. Unit tests for `itemMetadata`. |
| Hero waveform drawn from peaks before audio arrives | e2e holds the preview request open, then reads the canvas pixels: more than 100 drawn bar columns with the loop's shape (not uniform loading bars), the preview requested once, still not played. |
| Tempo, key, loop and volume controls bound to the engine | e2e: Space plays; `]` `]` reads back Em with +2; `=` reads 91; End on the tempo slider reads 180, still playing; reset returns to 90 and Dm. Tempo and key set before play are applied on start. Loop off (now `engine.setLoop`) stops at the end of the pass. Volume mute and unmute reach the player bar's slider. Audible: at 180 BPM the playhead moves at 2.00x wall time in the built app ("at double tempo the loop really plays twice as fast", asserts more than 1.5). |
| Download calls requestDownload and shows the license | `server-actions.ts` calls `requestDownload({ itemId })`. e2e with the local adapter: the file saves, the record "Downloaded under Royalty-free 1.0" with the file name, the toast. Signed out asks to sign in and comes back to finish. Unit tests for the local adapter's record. |
| First sound under 300 ms, LCP under 2.0 s, CLS under 0.05 | `e2e/perf/budgets.spec.ts` in `pnpm perf`: loop page LCP 552 to 612 ms, CLS 0, 204,702 bytes of compressed script before audio (budget 204,800), on CPU 4x and 4G; first sound after Space 142 to 173 ms (budget 300). |

### How the e2e stubs data
- The test server runs with `STASH_DEV_PAGES=1` (playwright.config.ts already sets it). The real
  route `/loop/dusty-soul-chops-k3j9x0a2b1` is then answered by the loader from
  `_item/fixtures.ts`: the gallery's five fixture loops, with real peaks, parsed with `itemPageSchema`.
  There is no database and no mock server, and the page is still server-rendered.
- The cookie `stash-dev-viewer=member` (only read when the flag is set) makes the fixture viewer
  signed in. The fixture source answers like, follow and download in the browser.
- Preview audio at `https://media.stash.local/**` is answered by `page.route` with a fixture file:
  WAV in the journeys, MP3 in the perf check (as shell.spec.ts does).
- A production build never takes the fixture branch: unit test "reads the real query in
  production, even for a fixture id".

## Review round 1 (PR #15, reviewed at 947bb97)
Merged first: foundations a6fce8f (e2e env defaults, 800 px project, visual:update changed-only;
one add/add conflict on `home-visual-tablet.png`, foundations' copy kept), then lane/audio-123 473aa6e
(stretch from a served worklet, `setLoop`) and foundations 8dc75a3. PR #15's base is
lane/interface-132, so the audio-123 commits show in its diff until #10 merges. audio-123 was merged
again at 05b326d (loop-off fixes, worklet retry); one `.gitignore` conflict (blank line), and the
checks below are from after that merge.

**Blocking**
- **D1** Download on screen at every width. The in-panel Download / Like / Copy row shows only from
  `cq-xl` (the panel beside the player); below that, the pinned bar (`data-download-bar`) stays
  until `cq-xl`, with the license named in it ("ROYALTY-FREE"). e2e "at {1440,1024,800,380} px,
  download is on screen without scrolling, and only once" (`toBeInViewport({ ratio: 1 })`, exactly
  one visible Download, license named beside it, no sideways scroll).
- **D2** The phone facts beside the play pad read the player's live tempo and `transposedKey`, the
  values the transport shows. e2e: `90 BPM · Dm`, then `]` `]` `=` gives `91 BPM · Em`.
- **D3** Loop on has a `border-border-strong` edge with `text-text`, and an engraved `ON` / `OFF`
  (`font-mono text-numeric`, `aria-hidden`: aria-pressed already says it) beside the button. Unit
  test on the markup; e2e checks the word and that the edge color changes.
- **T1** `actionsFor(source, page)` (`_item/actions-source.ts`) picks the actions; the page calls it.
  `actions-source.test.ts` mocks `@/server/downloads/actions` and asserts `serverActions.download(id)`
  calls `requestDownload({ itemId: id })` with save "navigate", and that "server" selects
  serverActions and "local" the blob-saving local ones.
- **T2** `?then=` only names the action. Pressing Sign in in the dialog stores
  `{ intent, itemId, at }` in sessionStorage (`_item/intent.ts`, every access in try/catch). On the
  way back the page acts only if that marker matches this item and intent and is under 30 minutes
  old; any marker is cleared once read, and `?then=` is always removed from the address. Unit tests
  (match once, other item, other intent, stale, corrupt, storage that throws). e2e: a bare
  `goto(...?then=download)` signed in saves nothing and shows no record (also with a marker for
  another item), and the real flow (press D, Sign in, cookie, follow `next`) still downloads. Note:
  sign-in by email link opened in a new tab has no marker there, so the visitor presses Download
  again: a safe failure.

**Advisory**
- Hero pad centred on the waveform (`tablet:items-center`).
- Download tooltip on the bottom in the panel (top in the pinned bar). The license badge takes
  `summaryTooltip={false}` where the summary is on screen.
- The audio error is inside the hero card, under the waveform.
- 40 px touch targets: byline and "Read the full license" get an `::after` reaching 12 px above and
  below; the badge 8 px; row titles `-my-3 py-3` (`truncate` would clip an `::after`). A
  getBoundingClientRect audit still reports the visible box; the hit area is the larger one.
- Transport: two by two (tempo | key, loop | volume) from `cq-md`; one row from `cq-lg`, now a flex
  row with tempo at twice the volume's share, key and loop at their natural width.
- `error.tsx` for the item route (an `ErrorState` with Retry; its view loads lazily). **No
  `loading.tsx`**: I built it (hero-matching skeleton) and it broke the route's status codes. A
  loading boundary makes Next stream the page, so `notFound()` answers 200 instead of 404 and the
  old-slug redirect stops being a server redirect; the 404 and redirect journey failed, and early
  key presses landed before the streamed page hydrated. Correct statuses matter more for crawlers
  than a skeleton on a page that renders in about 0.6 s. The skeleton is kept out of the branch; say if
  you want it with that trade.
- The double-tempo journey: first an explicit rate-about-1 assertion replacing `test.fail()`, then,
  with the audio-123 fix merged, a real assertion: rate above 1.5 (measured 2.00).
- The fixture loader refuses when `VERCEL_ENV === "production"`, even with STASH_DEV_PAGES=1 (unit
  test).
- Loop switch: `loop-watch.ts` is gone; the page reads `EngineState.loop` and calls
  `engine.setLoop`. `loop: true` added to the EngineState literal in now-playing.test.ts.

**Script budget.** These changes added bytes, so more moved behind first use: the license record
and the file-saving code (`_item/download-record.tsx`), the intent marker code (loaded only on the
way back from sign-in), and the error view. The loop page is **204,702 bytes** of 204,800: **98 bytes of
headroom** after audio-123 05b326d grew the engine. `/` is 184 KB. The next byte any shared code adds
puts item pages over; the remaining big piece the page owns is the "More from" rows, which cannot
move behind first use without losing their server-rendered HTML.

## Proof
At the branch head, STASH_E2E_PORT=3237 (foundations now supplies the e2e environment defaults):
```
$ pnpm check && pnpm e2e
packages/contracts typecheck: Done
packages/audio typecheck: Done
packages/ui typecheck: Done
apps/web typecheck: Done
(eslint . --max-warnings 0: no output)
Running 75 tests using 2 workers
  ✓  34 [e2e] › e2e/journeys/loop-page.spec.ts:39:1 › the page is server-rendered with its metadata and preview card (192ms)
  ✓  35 [e2e] › e2e/journeys/loop-page.spec.ts:55:1 › an old slug redirects to the canonical address, and an unknown item is not found (553ms)
  ✓  36 [e2e] › e2e/journeys/loop-page.spec.ts:62:1 › the hero waveform is drawn from the stored peaks before any audio arrives (455ms)
  ✓  37 [e2e] › e2e/journeys/loop-page.spec.ts:93:1 › space plays and pauses; tempo and key drive the engine while it plays (972ms)
  ✓  39 [e2e] › e2e/journeys/loop-page.spec.ts:147:1 › tempo and key set before play are applied when it starts (488ms)
  ✓  40 [e2e] › e2e/journeys/loop-page.spec.ts:160:1 › loop off stops at the end of the pass; volume is shared with the player bar (938ms)
  ✓  38 [e2e] › e2e/journeys/loop-page.spec.ts:125:1 › at double tempo the loop really plays twice as fast (2.6s)
  ✓  41 [e2e] › e2e/journeys/loop-page.spec.ts:182:1 › signed out, download asks to sign in and comes back to finish (673ms)
  ✓  42 [e2e] › e2e/journeys/loop-page.spec.ts:192:1 › signed in, download saves the file and shows the license record (617ms)
  ✓  43 [e2e] › e2e/journeys/loop-page.spec.ts:206:1 › coming back from sign-in finishes the download that was asked for (1.1s)
  ✓  45 [e2e] › e2e/journeys/loop-page.spec.ts:241:1 › signed in, like and follow toggle with their counts (410ms)
  ✓  46 [e2e] › e2e/journeys/loop-page.spec.ts:256:1 › signed out, like and follow ask to sign in (773ms)
  ✓  47 [e2e] › e2e/journeys/loop-page.spec.ts:266:1 › more from the uploader plays in place and becomes the queue (515ms)
  ✓  44 [e2e] › e2e/journeys/loop-page.spec.ts:221:1 › a bare link with ?then=download does nothing, even signed in (2.7s)
  ✓  48 [e2e] › e2e/journeys/loop-page.spec.ts:279:1 › on a phone, download is pinned above the mini player (326ms)
  ✓  49 [e2e] › e2e/journeys/loop-page.spec.ts:295:3 › at 1440 px, download is on screen without scrolling, and only once (337ms)
  ✓  50 [e2e] › e2e/journeys/loop-page.spec.ts:295:3 › at 1024 px, download is on screen without scrolling, and only once (395ms)
  ✓  51 [e2e] › e2e/journeys/loop-page.spec.ts:295:3 › at 800 px, download is on screen without scrolling, and only once (371ms)
  ✓  52 [e2e] › e2e/journeys/loop-page.spec.ts:295:3 › at 380 px, download is on screen without scrolling, and only once (331ms)
  ✓  53 [e2e] › e2e/journeys/loop-page.spec.ts:309:1 › on a phone, the facts beside the play pad follow the tempo and the key shift (401ms)
  ✓  54 [e2e] › e2e/journeys/loop-page.spec.ts:321:1 › the loop switch says ON or OFF in words as well as its pressed state (514ms)
  ✓  55 [e2e] › e2e/journeys/loop-page.spec.ts:334:1 › the loop page passes the accessibility scan, idle and playing (2.1s)
loop page playback rate at 180 BPM: 2.01
  (the other 53, gallery, shell and smoke, all ✓)
  75 passed (46.7s)

$ pnpm perf
  ✓ every audio check (37), including audio-stretch-minified "after one failed fetch of the worklet
    file, the next tempo change loads it again and is heard"
/: LCP 184 ms, CLS 0.0000, script 184 KB
/loop/dusty-soul-chops-k3j9x0a2b1: LCP 572 ms, CLS 0.0000, script 200 KB   (204,702 bytes)
loop page first sound after space: 123 ms
  43 passed (52.6s)

$ pnpm test
 Test Files  36 passed | 1 skipped (37)
      Tests  648 passed | 9 skipped (657)

$ pnpm run licenses
All dependency licenses are on the allowed list.
```

**`pnpm visual`**: no Docker here, so the baselines came from CI: this head (3bbbb4f) was pushed to
`visual-update/135-r1`, the Visual baselines run passed (45306948613) and committed 18 PNGs, and I
reviewed them before merging them in (a8c537a):
- `loop-page` at desktop, laptop, tablet (800) and phone: Download in the license panel at
  desktop, and in the pinned bar with the license name at the other three; the transport is one row,
  then two by two, then stacked; the loop switch shows ON.
- `gallery-c-stepper` and `gallery-c-transport` (new) at the four widths.
- Small changes to `gallery-c-license` (laptop) and `gallery-c-player` (four widths), from the
  badge and row-title touch targets.
- `home-visual-tablet`: the merge kept foundations' copy, which had no shell; the new one has the
  shell, like the other home baselines.

## Not done
- Similar items (204), the share image route `/og/[id]` (the card is `summary` until it exists), the
  global keyboard map and the `?` dialog (225), and like and follow on the server (301).
- The player bar's BPM and KEY readouts still show the item's own values, not the shifted ones: the
  lead moved it to 136 polish.
- `loading.tsx` (see the review round: it would turn 404s and redirects into 200s).

## Surprises and decisions
- **The time stretch did not load in the built app** (minified worklet, request
  135-stretch-in-production-build). Fixed in lane/audio-123 473aa6e plus the lead's served worklet;
  the double-tempo journey now asserts the real rate.
- **Every page answers 500 without Supabase settings.** Since 101's `src/proxy.ts` runs on every route
  with no public Supabase variables, `/`, `/dev/gallery` and `/dev/player` all fail in
  playwright.config's server, in CI's browser job and in visual-update.yml, not only the loop page.
  Request 135-e2e-supabase-env asks for placeholder variables, or for the proxy to pass through.
  (Landed: foundations a6fce8f sets the defaults.)
- **Loop off** is the engine's `setLoop` now (request 135-engine-loop-switch, landed in audio-123).
- **The local download is the preview.** The fixture and demo source saves the preview file (`.ogg`
  address), named from the title like requestDownload does. The server source saves the original.
- **The route segment is `[item]`**, because Next cannot split `[slug]-[id]`; `itemPage` parses it.
- **Dynamic, not cached.** The page reads the viewer, so it renders per request. Caching the public
  part (build spec: "refreshed when the item changes") needs the viewer state moved to a client
  fetch. That is a later performance ticket if LCP ever needs it: it is 0.7 s today on 4G.
- **No new dependencies.**

## Requests filed
- docs/requests/135-stretch-in-production-build.md (audio, lead)
- docs/requests/135-engine-loop-switch.md (audio, lead)
- docs/requests/135-e2e-supabase-env.md (lead, platform)
