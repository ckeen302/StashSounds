# 137 Browser-only demo build
Lane: interface (build script and publish: lead)
Depends on: 132, 135

## Goal
Caden can open one link and use Stash's listening loop with no accounts and no server: browse a
list of loops, hear each instantly, open a loop page, change tempo and key live, scrub the
waveform, queue next and previous, and "download" (a local file save with the license note). It is
a faithful slice of the real app: the same shell, components, player bar and audio engine, fed by
static demo data instead of the database.

## Owned paths
apps/web/src/app/(demo)/ or apps/web/src/app/demo/, apps/web/src/demo/, packages/ui (if needed), e2e/journeys/demo.spec.ts.
Lead: scripts/build-demo.mjs and the published artifact.

## Spec and contracts that apply
- design-spec.md: shell, player bar, result rows, loop page
- contracts: itemRowSchema, itemPageSchema, playableSchema. Demo data is parsed with these schemas,
  so it cannot drift from the real shapes.

## Acceptance criteria
- [ ] `STASH_DEMO=1 pnpm --filter @stash/web build` produces a fully static export (no server actions,
      no Supabase calls, no API routes reached) that runs from any static host under a sub-path.
- [ ] Demo data: the five generated loop fixtures (fixtures/generated/loops), transcoded to MP3
      previews plus 800-point peaks by a build step (the lead's script runs ffmpeg and the worker's
      peaks code; the interface code only reads the produced JSON and files). Titles, owners,
      handles, BPM, key and tags are plausible and clearly demo data.
- [ ] Home or Browse shows the loops as result rows; clicking a row plays instantly (preloaded on
      hover); the row list is the player's queue.
- [ ] Each loop has its own page: waveform with playhead, tempo and key controls that change the
      sound live, download (saves the preview file, shows the license), more from the owner.
- [ ] Like and follow toggle locally (in memory or localStorage) with a gentle "demo" note; sign-in,
      upload and notifications show a friendly "not in the demo" state, never a broken page.
- [ ] Works at 1440, 1024 and 380. Keyboard: space plays, arrows move through the list.
- [ ] An e2e journey runs against the static export: play from the list, open a loop page, change
      tempo, next, and download.

## Out of scope
Real accounts, uploads, processing, search.
