# Request 133 Supabase for the browser and visual-update jobs
From lane: interface
For: lead
Blocking ticket: 133 (and every Interface PR since platform 101 merged in)

## What I need changed
`.github/workflows/ci.yml` (browser job) and `.github/workflows/visual-update.yml`. Both are lead-owned.

1. **Public env on both jobs.** Since 101, `apps/web/src/proxy.ts` calls `publicEnv()` on every
   request. Without `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `NEXT_PUBLIC_PREVIEWS_BASE_URL`, every page throws, so screenshots and journeys fail. Signed-out
   pages need only the values, not a running stack: `auth.getUser()` with no cookie never calls
   Auth. The local defaults in `.env.example` are enough. They have to be present at build time
   too, because Next inlines `NEXT_PUBLIC_*`.
2. **The Supabase stack and Mailpit on the browser job.** The CI job runs this with `supabase start`
   on the runner host and `--network host`, or with service containers, before `next start --port 3100`.
   - `e2e/journeys/sign-in.spec.ts` has a block that signs up for real. It requests an email link,
     reads the link from Mailpit (`http://127.0.0.1:54324/api/v1/...`), claims a handle, and covers
     the signed-out like, follow and download completing after sign-in.
   - The tests read `NEXT_PUBLIC_SUPABASE_URL` and `STASH_MAILPIT_URL` (default
     `http://127.0.0.1:54324`).
   - The server must run on port 3100: `supabase/config.toml` allows only the 3000 and 3100
     callbacks in `additional_redirect_urls`. Other ports fall back to `site_url`.
   - In CI (`CI` set) the block **fails** when the stack is unreachable rather than skipping.
     Locally, without `pnpm dev`, it skips and says why.
3. **Optional:** add `http://localhost:3132/api/auth/callback` (or a wildcard for local test
   ports) to `additional_redirect_urls`, so worktrees on their own `STASH_E2E_PORT` can run the
   sign-up journeys.

## Why
The ticket's acceptance criteria include "End-to-end test: sign up by email link (local inbox),
claim handle, land on home". Docker is not available in the builder containers, so CI is the only
place that test can run.

## Workaround in the meantime
- Locally the stack-backed block skips with "Needs the local Supabase stack and Mailpit". The
  twelve signed-out sign-in journeys run without it: provider buttons are checked against the
  intercepted authorize URL, the dialog against its `next`, and hostile `next` values against
  `/`.
- The 133 visual baselines (`login.png`, `sign-in-dialog.png`) are not generated yet. A
  `visual-update/133-*` run would screenshot error pages until item 1 lands.
