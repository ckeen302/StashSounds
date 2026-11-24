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
| Tempo, key, loop and volume controls bound to the engine | e2e: Space plays; `]` `]` reads back Em with +2; `=` reads 91; End on the tempo slider reads 180, still playing; reset returns to 90 and Dm. Tempo and key set before play are applied on start. Loop off stops at the end of the pass. Volume mute and unmute reach the player bar's slider. **Audible tempo and key change is blocked by an engine bug in the production build**: see Surprises and request 135-stretch-in-production-build. |
| Download calls requestDownload and shows the license | `server-actions.ts` calls `requestDownload({ itemId })`. e2e with the local adapter: the file saves, the record "Downloaded under Royalty-free 1.0" with the file name, the toast. Signed out asks to sign in and comes back to finish. Unit tests for the local adapter's record. |
| First sound under 300 ms, LCP under 2.0 s, CLS under 0.05 | `e2e/perf/budgets.spec.ts`: loop page LCP 704 to 712 ms, CLS 0, 160 to 190 KB of script before audio (budget 200), on CPU 4x and 4G; first sound after Space 155 to 172 ms (budget 300). |

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

## Proof
Lane check with STASH_E2E_PORT=3135 and the three placeholder public variables (request
135-e2e-supabase-env), after both merges:
```
$ export STASH_E2E_PORT=3135 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-placeholder NEXT_PUBLIC_PREVIEWS_BASE_URL=https://media.stash.local
$ pnpm check && pnpm e2e
packages/contracts typecheck: Done
packages/ui typecheck: Done
packages/audio typecheck: Done
apps/web typecheck: Done
(eslint . --max-warnings 0: no output)
Running 68 tests using 2 workers
  ✓  34 [e2e] › e2e/journeys/loop-page.spec.ts:39:1 › the page is server-rendered with its metadata and preview card (420ms)
  ✓  35 [e2e] › e2e/journeys/loop-page.spec.ts:55:1 › an old slug redirects to the canonical address, and an unknown item is not found (1.1s)
  ✓  36 [e2e] › e2e/journeys/loop-page.spec.ts:62:1 › the hero waveform is drawn from the stored peaks before any audio arrives (1.1s)
  ✓  37 [e2e] › e2e/journeys/loop-page.spec.ts:93:1 › space plays and pauses; tempo and key change the sound live (1.3s)
  ✓  39 [e2e] › e2e/journeys/loop-page.spec.ts:147:1 › tempo and key set before play are applied when it starts (1.1s)
  ✘  38 [e2e] › e2e/journeys/loop-page.spec.ts:127:1 › at double tempo the loop really plays twice as fast (3.2s)
  ✓  40 [e2e] › e2e/journeys/loop-page.spec.ts:160:1 › loop off stops at the end of the pass; volume is shared with the player bar (1.5s)
  ✓  41 [e2e] › e2e/journeys/loop-page.spec.ts:182:1 › signed out, download asks to sign in and comes back to finish (1.1s)
  ✓  42 [e2e] › e2e/journeys/loop-page.spec.ts:192:1 › signed in, download saves the file and shows the license record (1.2s)
  ✓  43 [e2e] › e2e/journeys/loop-page.spec.ts:206:1 › coming back from sign-in finishes the download that was asked for (1.0s)
  ✓  44 [e2e] › e2e/journeys/loop-page.spec.ts:214:1 › signed in, like and follow toggle with their counts (1.1s)
  ✓  45 [e2e] › e2e/journeys/loop-page.spec.ts:229:1 › signed out, like and follow ask to sign in (1.1s)
  ✓  46 [e2e] › e2e/journeys/loop-page.spec.ts:239:1 › more from the uploader plays in place and becomes the queue (1.1s)
  ✓  47 [e2e] › e2e/journeys/loop-page.spec.ts:252:1 › on a phone, download is pinned above the mini player (875ms)
  ✓  48 [e2e] › e2e/journeys/loop-page.spec.ts:267:1 › the loop page passes the accessibility scan, idle and playing (2.6s)
  (the other 53, gallery, shell and smoke, all ✓)
  68 passed (1.0m)
```
The ✘ is the expected failure marked `test.fail()` (see Surprises): Playwright counts it as passed,
and it will turn red the day the stretch works. The test at line 93 has since been renamed "space
plays and pauses; tempo and key drive the engine while it plays", which is what it proves.

```
$ pnpm test
 Test Files  31 passed | 1 skipped (32)
      Tests  605 passed | 9 skipped (614)

$ pnpm exec playwright test --project=perf e2e/perf/budgets.spec.ts
/: LCP 244 ms, CLS 0.0000, script 110 KB
  ✓  1 [perf] › e2e/perf/budgets.spec.ts:31:3 › / stays inside the page budgets (1.6s)
loop page first sound after space: 172 ms
  ✓  3 [perf] › e2e/perf/budgets.spec.ts:77:1 › the loop page sounds within the first-sound budget after space (584ms)
/loop/dusty-soul-chops-k3j9x0a2b1: LCP 712 ms, CLS 0.0000, script 160 KB
  ✓  2 [perf] › e2e/perf/budgets.spec.ts:31:3 › /loop/dusty-soul-chops-k3j9x0a2b1 stays inside the page budgets (3.4s)
  3 passed (14.2s)

$ pnpm run licenses
All dependency licenses are on the allowed list.
```
New unit tests: `packages/ui/test/transport.test.ts` (11) and `apps/web/src/app/_item/item.test.ts`
(17: fixtures, loader branches, metadata, key map, loop-off wrap, local actions).

**`pnpm visual` was not run**: Docker is not available on this machine. CI runs it. The new loop page test
(`loop-page.png` at three widths) and the gallery sections `c-stepper` and `c-transport` have no
baselines yet. The `visual-update/*` workflow cannot make them either until request
135-e2e-supabase-env lands, because that server also answers 500. I looked at the page myself at 1440,
1024 and 380 (idle, playing with tempo and key changed, the phone page end) and fixed what I saw:
- the loop switch was a second lit element, and is now a ghost toggle;
- the key hints showed on the phone;
- the tags were invisible on the page background;
- the transport and the license actions were cramped at 1024 (fixed by the container queries);
- two links were told apart by color alone (found by axe).

## Not done
- Similar items (204), the share image route `/og/[id]` (the card is `summary` until it exists), the
  global keyboard map and the `?` dialog (225), and like and follow on the server (301).
- The player bar's BPM and KEY readouts still show the item's own values, not the shifted ones. That
  is player-bar.tsx (132's file), so it waits for a follow-up.

## Surprises and decisions
- **The time stretch never loads in the built app (blocking the audible half of criterion 3).**
  `signalsmith-stretch` builds its AudioWorklet by stringifying its own functions. After the Next
  build minifies them, the worklet throws `ReferenceError: g is not defined` (`processorerror`), the
  library waits forever for `ready`, and `loadStretch` never settles. Engine state still says
  `tempoRatio: 2`, so the readouts show a change you cannot hear. The audio test page serves the
  library unminified, so `pnpm perf` there passes. This is in packages/audio, or in next.config, not
  mine: request 135-stretch-in-production-build has the trace and three fixes. The e2e test "at double
  tempo the loop really plays twice as fast" is marked `test.fail()` naming the request. It asserts
  today's broken state and fails the moment the fix lands, so it cannot be forgotten. It is a new
  test, not a loosened one, but the lead should confirm the marker is acceptable.
- **Every page answers 500 without Supabase settings.** Since 101's `src/proxy.ts` runs on every route
  with no public Supabase variables, `/`, `/dev/gallery` and `/dev/player` all fail in
  playwright.config's server, in CI's browser job and in visual-update.yml, not only the loop page.
  Request 135-e2e-supabase-env asks for placeholder variables, or for the proxy to pass through.
- **Loop off on the page.** The engine has no loop switch. While loop is off, the frame loop that
  draws the playhead pauses at the wrap and returns to the start, so up to one frame (about 16 ms) of
  the next pass may sound. Request 135-engine-loop-switch asks for `setLoop`.
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
