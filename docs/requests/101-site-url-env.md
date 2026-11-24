# Request 101 NEXT_PUBLIC_SITE_URL in .env.example and pnpm dev
From lane: platform
For: lead
Blocking ticket: 133 (sign-in links fail without it)

## What I need changed
Since the PR #4 review, sign-in redirect URLs are built from `NEXT_PUBLIC_SITE_URL` instead of
request headers (apps/web/src/server/env.ts `siteUrl()`: an http or https origin, nothing after
the host and port).
- `.env.example`: add `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.
- `scripts/dev.mjs`: set it for the web app (`http://localhost:3000`).
- The e2e web server (playwright.config.ts, port 3100) and CI: `NEXT_PUBLIC_SITE_URL=http://localhost:3100`.
- Production: the public origin, matching `site_url` in Supabase Auth.

## Why
`Host`, `Origin` and `X-Forwarded-*` are client-controlled. Supabase's redirect allow list is the
only other guard, so the origin should come from configuration.

## Workaround in the meantime
None. Without it, `signInWithEmail` and `signInWithProvider` throw a configuration error naming the
variable. Every other page keeps working, because the value is validated separately from the other
public settings.
