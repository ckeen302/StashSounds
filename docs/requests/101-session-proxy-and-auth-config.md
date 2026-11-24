# Request 101 Session refresh proxy and auth redirect URLs
From lane: platform
For: lead
Blocking ticket: 133 (end-to-end sign-in), not 101

## What I need changed
1. Create `apps/web/src/proxy.ts` (Next 16's renamed middleware) and assign it to a lane in
   CLAUDE.md. Platform suggests owning it, since it only calls Platform code:

   ```ts
   import type { NextRequest } from "next/server";
   import { updateSession } from "@/server/supabase/proxy";

   export function proxy(request: NextRequest) {
     return updateSession(request);
   }
   export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg|robots.txt).*)"] };
   ```

2. `supabase/config.toml` `[auth]`: allow the callback on the ports the app runs on, so Supabase
   does not fall back to `site_url` (port 3000) during end-to-end tests (port 3100):

   ```toml
   additional_redirect_urls = [
     "http://localhost:3000/api/auth/callback",
     "http://localhost:3100/api/auth/callback",
     "http://127.0.0.1:3000/api/auth/callback",
   ]
   ```
   The existing entry `https://127.0.0.1:3000` (https on a plain-http dev server) looks like a typo.

## Why
Server Components cannot write cookies, so an expired access token is only refreshed if the proxy
runs before rendering; without it a signed-in user looks signed out after an hour (jwt_expiry).
The sign-in actions send `<origin>/api/auth/callback?next=...` as the redirect URL.

## Workaround in the meantime
Server actions and the callback route refresh and write cookies themselves, so sign-in works;
only long-idle sessions on plain page loads are affected.
