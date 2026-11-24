# Handoff 137 Browser-only demo build

## Plan (waiting for the lead's go-ahead)
Branch `lane/interface-137` from `lane/interface-135` (1f68c1b). The demo is the real shell, player
bar, engine, result rows and loop page, fed by `apps/web/src/demo/generated/loops.json` (from the
lead's `scripts/build-demo.mjs`) instead of the database. There is no fork of any component.

### How the static export stays clean (needs request 137-demo-next-config, lead)
`STASH_DEMO=1 next build` must not see API routes, server actions, `proxy.ts` or Supabase. Next can
choose which files are routes through `pageExtensions`, and the proxy file respects it too. So:
- The demo's route files are `*.demo.tsx`, next to the real ones: `app/layout.demo.tsx`,
  `app/page.demo.tsx`, `app/[type]/[item]/page.demo.tsx` (with `generateStaticParams`),
  `app/not-found.demo.tsx`, and small "not in the demo" pages for login, upload, library,
  notifications and profile.
- Asked of next.config.ts (lead), only when `STASH_DEMO=1`: `output: "export"`,
  `pageExtensions: ["demo.tsx", "demo.ts"]`, `basePath` from `STASH_DEMO_BASE_PATH` (for example
  `/stash-demo`), `trailingSlash: true`, and no `headers()` (unsupported in export). The normal build
  is unchanged: a `page.demo.tsx` is not a route there, because its name is not `page`.

### Data (apps/web/src/demo/, mine)
- `demo-data.ts` maps each `loops.json` entry into an `ItemRow` and `ItemPage`, and parses both with
  `itemRowSchema` and `itemPageSchema` at build time (server side, so zod never ships).
- Demo copy: five titles, three demo producers with handles and avatars made of initials, tags,
  genres and "in the style of" references. Every owner is marked as demo data (a "Demo" plate on the
  uploader card, and descriptions saying so).
- Ids are stable UUIDs derived from the slug. The preview URL is `basePath + "/" + preview.path`, and
  `playable` is a `loop` with `loopSamples` and `sampleRate` from the JSON.

### Item page without server actions
`ItemView` takes its `actions` as a prop instead of choosing them inside. The real route renders a
small client wrapper (`item-view-server.tsx`) that calls `actionsFor(source, page)`. The demo route
renders `item-view-demo.tsx`, which imports only the local actions, so nothing on the demo's path
imports `@/server/*`. The T1 test still covers `actionsFor`.
- Download saves the preview with the license record (the local actions already do this).
- Like and follow toggle in localStorage (in try/catch, with an in-memory fallback), with a toast
  saying "Saved in this browser: this is the demo".
- Sign-in is never asked for in the demo: the demo viewer is signed in. Sign in, upload,
  notifications and library show a friendly "not in the demo" state with a link back to the loops.

### Home and browse
`page.demo.tsx` lists the five loops as result rows: the list is the queue, a row preloads on
hover, and a click plays at once. The up and down arrows move through the list (row focus), and
space plays. The shell and player bar are the real ones; a slim "Demo" plate sits in the top bar.

### Requests (lead and Audio)
- **137-demo-next-config** (lead): the `next.config.ts` switch above.
- **137-demo-worklet-base** (Audio): the engine loads the stretch from `/worklets/...`, an absolute
  path. Under a sub-path that file is at `<basePath>/worklets/...`, so tempo would fall back after
  3 s. Ask: an option on the first `getEngine()` call, or `setStretchModuleUrl(url)`, so the app
  can pass the basePath. `copy-stretch-worklet.mjs` already runs in the build script, so the file
  is in the export.
- **137-demo-e2e-project** (lead): a `demo` project in playwright.config.ts whose `webServer` runs
  `node scripts/build-demo.mjs && STASH_DEMO=1 STASH_DEMO_BASE_PATH=/stash-demo pnpm --filter
  @stash/web build` and then serves `apps/web/out` under the base path with a static server (I can
  write the tiny server under e2e/ if you prefer). `e2e/journeys/demo.spec.ts` runs there: play from
  the list, open a loop page, change tempo, next, download.
- The data shape from `build-demo.mjs` works as it is. No change is needed.

### Tests first
- Unit: the demo data parses with the schemas, its ids are stable, its preview URLs carry the
  basePath, and its owners are marked as demo. localStorage like and follow survive a reload and
  never throw.
- e2e on the export: the journey above, plus the "not in the demo" pages and the three widths.
- Lane check: `pnpm check && pnpm e2e`, `pnpm perf` (the loop page budget is unchanged: the demo
  wrapper replaces the server one), and visual baselines through `visual-update/137-r1`.
