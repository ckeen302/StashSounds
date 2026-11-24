# Request 135 Public Supabase settings for the e2e and CI web server
From lane: interface
For: lead (playwright.config.ts, .github/workflows/ci.yml), platform (src/proxy.ts)
Blocking ticket: 135, and every Interface e2e run after 101 merged

## What I need changed
Since `apps/web/src/proxy.ts` (101) runs `updateSession` on every page, a server started without
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_PREVIEWS_BASE_URL` answers
every page with 500 ("Missing or invalid environment variables"). The e2e web server in
playwright.config.ts and the CI `browser` job set none of them, so `/`, `/dev/gallery` and
`/dev/player` all fail there, not only the loop page.

Either:
1. Lead: set placeholder values for the test server, in playwright.config.ts's `webServer.env` and
   in ci.yml's `browser` job, for example
   `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-placeholder`,
   `NEXT_PUBLIC_PREVIEWS_BASE_URL=https://media.stash.local` (what the fixtures already use). With
   nothing listening on 54321, `getUser()` fails fast and visitors are signed out. Or
2. Platform: have `updateSession` pass the request through when the public settings are missing,
   logging once, so pages that do not read data still render.

## Why
The lane check (`pnpm e2e`) cannot pass without a database otherwise.

## Workaround in the meantime
I ran the lane check with those three placeholder variables exported in the shell (the web server
inherits them). The command is in docs/handoffs/135-loop-page.md.
