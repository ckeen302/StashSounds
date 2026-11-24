# Request 132 Turn on dev pages for the test servers and local dev
From lane: interface
For: lead
Blocking ticket: 132 (CI for PR #12: the shell journeys use /dev/player)

## What I need changed
`/dev/player` now answers 404 unless the server runs with `STASH_DEV_PAGES=1`, so it is never
reachable in production (the lead's condition on PR #12). The flag is read per request
(`apps/web/src/app/_shell/dev-pages.ts`), so one build serves both cases. The servers that run the
tests need the flag. These paths are lead-owned:

1. `playwright.config.ts`: add `env: { ...process.env, STASH_DEV_PAGES: "1" }` to `webServer`. This
   covers `pnpm e2e` and `pnpm perf`.
2. `scripts/visual.mjs`: start the host `next start` with
   `env: { ...process.env, STASH_DEV_PAGES: "1" }`, so `pnpm visual` matches.
3. `pnpm dev` (scripts/dev or the root package.json script): set `STASH_DEV_PAGES=1` for local work.
   Also add the variable to `.env.example`, commented as "never set in production".
4. CI: nothing more. Items 1 and 2 cover its jobs, as long as the production deploy does not set
   the variable.

## Why
The end-to-end tests need a page that plays real rows through the engine before the screens with
data exist. The page must not exist in production.

## Workaround in the meantime
Locally I ran `STASH_DEV_PAGES=1 pnpm e2e` and `STASH_DEV_PAGES=1 pnpm visual`. Both Playwright's
webServer and visual.mjs pass their environment through to `next start`. Without the flag, the
/dev/player journeys in `e2e/journeys/shell.spec.ts` fail with a 404. That failure is intended until
items 1 and 2 land.
