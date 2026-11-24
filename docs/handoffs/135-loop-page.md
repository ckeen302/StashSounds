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
