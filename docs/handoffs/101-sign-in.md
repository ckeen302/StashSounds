# Handoff 101 Sign-in by email link, Google and Discord; profile and account rows; handle claim

## Plan (pre-approved by the lead within the ticket and the Platform paths)

Files (all under apps/web/src/server/ and apps/web/src/app/api/ unless noted):
- `server/env.ts`: Zod schema for the public Supabase env (URL, anon key, previews base URL). The
  `NEXT_PUBLIC_*` names are read literally so Next inlines them into the browser bundle.
- `server/supabase/server.ts` (cookie-bound server client via `next/headers`),
  `server/supabase/browser.ts` (browser client), `server/supabase/proxy.ts` (`updateSession` for a
  `src/proxy.ts` that refreshes the session cookie; wiring the file itself is a request, it is not a
  Platform path).
- `server/errors.ts`: maps Postgres and Supabase Auth errors to contracts `ErrorResult`. `P0001`
  messages start with the code (`conflict: That handle is taken.`); 23505 is conflict, 23514 and
  22xxx invalid, 42501 forbidden. Anything else is a bug and is rethrown without internals.
- `server/action.ts`: the single action wrapper `defineAction({ input, output, auth, rateLimit,
  handler })`. Auth modes: `public`, `user` (signed in, handle may be unclaimed: claimHandle only),
  `member` (signed in, handle claimed, not suspended: everything else). Parses input with the
  contracts schema (invalid + field errors), runs the rate limit hook, runs the handler, parses the
  output with the contracts schema, returns `Result<T>`. Dependencies are injected so it is unit tested
  with a fake Supabase client; nothing here needs live Supabase.
- `server/session.ts`: `loadSession(client)`, `getSession()`, `requireUser()` returning
  `{ user, profile, account }` with `profile: null` meaning the handle is not claimed yet.
- `server/profile.ts`: row to `Profile` / `Account` mapping (avatar URL from the previews bucket,
  quota from the role and limits.json, emailVerified from auth).
- `server/auth/*`: `claimHandle`, `updateProfile`, `signInWithEmail`, `signInWithProvider` (google,
  discord), `signOut` as action definitions, plus `actions.ts` (`"use server"`) exporting them.
- `app/api/auth/callback/route.ts`: exchanges the PKCE code (or verifies an email `token_hash`), then
  redirects to a sanitized `next` path, or to `/login?next=...` when the handle is not claimed.
- `supabase/tests/sign-in.test.ts`: database tests the server relies on: reserved handles in the
  migration match `RESERVED_HANDLES` in contracts, every claim_handle failure is `P0001` with a
  contracts code prefix, a suspended user cannot change handle, a new user has no profile row.

Tests first: unit tests for each error code through the wrapper, the error mapper, the session
helpers, both profile actions (wrong user, unauthenticated, invalid, reserved, taken), the sign-in
actions and the callback's redirect sanitizing.

Ticket issues found while planning:
- Contracts have no input schema for the sign-in actions (email, provider). They are defined locally
  from contracts primitives and proposed in docs/requests/101-sign-in-contracts.md.
- The session refresh needs `apps/web/src/proxy.ts`, which no lane owns yet. Requested.
- `profiles_update` lets a suspended user edit their profile directly. The wrapper refuses it, but the
  policy does not. Requested, not changed.

## What changed
All under apps/web/src/server/ unless noted.
- `env.ts`: `publicEnv()` validates `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `NEXT_PUBLIC_PREVIEWS_BASE_URL` (all already in .env.example) with Zod; the error names the bad
  variables and never prints their values.
- `supabase/server.ts` `createServerSupabase()` (cookie-bound, per request), `supabase/browser.ts`
  `createBrowserSupabase()`, `supabase/proxy.ts` `updateSession(request)` for a future `src/proxy.ts`.
- `action.ts` `defineAction({ name, auth, input, output, rateLimit?, handler })`, the single wrapper.
  It runs in this order: session (`public` / `user` / `member`), contracts input (`invalid` with
  `fields` keyed by path), the rate limit hook, the handler, then contracts output (a mismatch throws,
  because it is a bug). Handlers return `Result` via `ok`/`err` from contracts or throw database
  errors. `member` refuses an unclaimed handle ("Choose a handle first.") and a suspended account.
- `errors.ts` `mapError()`: P0001 `code: message` maps to that contracts code. 23505 maps to conflict;
  23514, 23502 and 22xxx to invalid; 42501 to forbidden; PGRST116 to not_found. Supabase Auth errors
  map by status: 429 to rate_limited, 400/422 to invalid, 401/403 and a missing session to
  unauthorized. Anything else returns null and the wrapper rethrows it. No error code is ever made up.
- `session-core.ts` `loadSession(client)`, `session.ts` `getSession()` (React `cache`, per request) and
  `requireUser({ next? })` (redirects to `/login[?next=]`). Both return `{ user: { id, email,
  emailVerified }, profile: Profile | null, account: Account | null }`, where `profile: null` means
  the handle is not claimed. They use `auth.getUser()` (validated by Supabase Auth), not the
  cookie's contents.
- `profile.ts`: row to contracts mapping. avatarUrl comes from the previews base URL,
  storageQuotaBytes from the role and limits.json (the same rule as create_upload_draft), and
  emailVerified from `email_confirmed_at`. Selects name their columns (`PROFILE_COLUMNS`,
  `ACCOUNT_COLUMNS`).
- `auth/profile-actions.ts`: `claimHandle` (auth `user`; checks reserved handles first, calls the
  `claim_handle` RPC, returns conflict/invalid with `fields.handle`) and `updateProfile` (auth
  `member`; drops unknown keys, writes only `id = caller`, avatar path must sit under the caller's
  folder, zero rows updated returns not_found).
- `auth/sign-in.ts`: `signInWithEmail` (magic link), `signInWithProvider` (google | discord, returns
  the authorize URL for the browser to open, PKCE), `signOut` (local scope).
- `auth/callback.ts` + `app/api/auth/callback/route.ts`: GET `/api/auth/callback` exchanges `code`, or
  (before the review round) verified `token_hash` for the email link types, then redirects to the sanitized `next` (or `/`).
  A user with no profile goes to `/login?next=...` to claim a handle. On failure it redirects to
  `/login?error=signin_failed[&next=...]`. The response is `Cache-Control: private, no-store`.
- `auth/actions.ts` (`"use server"`): what ticket 133 calls. `index.ts` re-exports everything for
  Server Components. Client Components import from `@/server/auth/actions` and
  `@/server/supabase/browser`, because the barrel pulls in `next/headers`.
- `testing/fake-supabase.ts`: an in-memory fake Supabase client for unit tests.
- `supabase/tests/sign-in.test.ts`: 11 database tests. They check that the reserved handles match
  contracts, that every claim_handle refusal is P0001 with a contracts code prefix (suspended gives
  forbidden), that anon gets 42501, and that the server's column lists exist. They also cover the
  new-user state, the display name defaults, a freed handle, and that another user's row is never
  updated.

New dependencies (apps/web/package.json):
- `@supabase/ssr` 0.12.7, MIT. Cookie-based Supabase sessions for Next server and browser.
- `@supabase/supabase-js` 2.119.0, MIT. The Supabase client, peer of @supabase/ssr. I pinned it
  to 2.119.0 rather than 2.119.2, which was only 4 days old.
- `zod` 4.6.7, MIT. Already in the tree through contracts; apps/web imports it directly for the
  env and local schemas.
`pnpm run licenses`: "All dependency licenses are on the allowed list."

## Proof
`pnpm check && pnpm test && pnpm db:test`, exit 0:
```
> pnpm -r --parallel typecheck && tsc -p tsconfig.json && eslint . --max-warnings 0
Scope: 4 of 5 workspace projects
apps/web typecheck: ✓ Types generated successfully
packages/ui typecheck: Done
packages/contracts typecheck: Done
packages/audio typecheck: Done
apps/web typecheck: Done
> stash@ test
> vitest run
 Test Files  10 passed (10)
      Tests  178 passed (178)
> stash@ db:test
> vitest run --config supabase/tests/vitest.config.ts
 Test Files  2 passed (2)
      Tests  87 passed (87)
```
The web project alone has 6 files and 76 tests, all new: errors 6, action wrapper 16, session and
mapping 14, profile actions 20, sign-in and callback 17, env 3. The baseline before this ticket was
102 unit and 76 db tests.
`pnpm --filter @stash/web build` also succeeds and lists `ƒ /api/auth/callback`.

Acceptance criteria:
- Server and browser clients with env validated by Zod: `supabase/*.ts`, `env.ts`, env.test.ts.
- Wrapper with a unit test per error code: action.test.ts ("returns each contracts error code…",
  plus unauthorized, forbidden, invalid and rate_limited paths).
- getSession/requireUser with `null` profile before the claim: session.test.ts.
- claimHandle and updateProfile, with P0001 mapped by prefix: errors.test.ts and profile-actions.test.ts.
- Wrong user, unauthenticated, invalid, reserved and taken handle: profile-actions.test.ts, with the
  database side in supabase/tests/sign-in.test.ts.

## Not done
- No live Supabase test. Docker Hub is rate-limited here, so the Supabase stack (GoTrue) cannot
  start. Everything that needs live auth (getUser, signInWithOtp/OAuth, code exchange, cookie
  writing) is unit tested against a fake client. The real email-link round trip is first exercised
  by ticket 133's end-to-end test.
- Google and Discord stay `enabled = false` in supabase/config.toml (lead-owned; the secrets go in
  supabase/.env).
- No rate limit on claimHandle or the sign-in actions beyond Supabase Auth's own email limit. The
  hook exists; ticket 203 fills it.
- `src/proxy.ts` is not created (not a Platform path); see requests.

## Surprises and decisions
- The worktree started on the initial commit, not `phase-0/foundations`. I branched
  `lane/platform-101` from `origin/phase-0/foundations` (fa3fc9f).
- The ticket's "Unit tests: wrong user" has no target user, because both actions act on
  `auth.uid()`. I tested it as: ids and handles in the input are stripped, only the caller's row
  is written, an avatar path in another user's folder is refused, and the database never updates
  another user's row.
- claim_handle answers a reserved handle with `conflict: That handle is taken.`, so the server does
  the same and does not reveal that the handle is reserved.
- `handleSchema` in contracts rejects capitals ("Alice" is invalid), although claim_handle would
  lowercase them. The form in 133 should lowercase as the user types.
- The contracts have no `internal` error code. Errors that cannot be mapped are rethrown, so Next
  shows its error boundary, instead of being labelled with a misleading code.
- The callback sends a new user to `/login?next=...`. The /login page (133) should show the handle
  form when `getSession()` returns a user with `profile: null`, and an error message for
  `?error=signin_failed`.
- `supabase/tests/global-setup.ts` drops and recreates a fixed `stash_test_template` database. Two
  worktrees running `pnpm db:test` at the same time against the same Postgres would collide. It
  did not happen here; I am reporting it, not changing it.

## Requests filed
- docs/requests/101-sign-in-contracts.md: sign-in input/output schemas into contracts (local copy in
  `server/auth/schemas.ts` until then). Answered by the lead; the local copy is gone (review round).
- docs/requests/101-session-proxy-and-auth-config.md: create and assign `apps/web/src/proxy.ts`, and
  add the callback URLs (ports 3000 and 3100) to `additional_redirect_urls`.
- docs/requests/101-suspended-profile-edits.md: `profiles_update` should require `is_active_user()`.

## Review round (PR #4)
No finding was blocking. Each fix below is a new commit on top of 263d483, with no force-push.
Where this section conflicts with the sections above, this section is current.

1. Merged `origin/phase-0/foundations` at 9c4c323 (494aeac).
   - Switched to the sign-in schemas now in `@stash/contracts` and deleted
     `server/auth/schemas.ts`.
   - Created `apps/web/src/proxy.ts`, which calls `updateSession`. `next build` lists
     "ƒ Proxy (Middleware)".
   - Fixed the request link in `supabase/proxy.ts`.
   - The merge brought the lead's test that a suspended user gets 0 rows when editing their profile
     (policies.test.ts). I added a stronger one in sign-in.test.ts: writing every editable column
     (display name, bio, links, avatar) changes nothing, and the user can edit again once restored.
2. Sign-in redirect URLs now come from `NEXT_PUBLIC_SITE_URL` through `siteUrl()` in env.ts.
   - The value must be an http or https origin with no path, query or credentials.
   - It is validated on its own, so a missing value breaks only sign-in, not every page.
   - `request-deps.ts` no longer reads any request headers, the wrong comment about Origin checks
     is gone, and `origin` is removed from `ActionDeps` and `ActionContext`.
   - Tests: env.test.ts (valid and invalid values) and sign-in.test.ts (the redirect origin comes
     only from the env; without it no link is sent).
   - The variable is not yet in .env.example or `pnpm dev`, which are lead-owned. Filed
     docs/requests/101-site-url-env.md.
3. Removed the `token_hash` / `verifyOtp` branch. The callback accepts only the PKCE code, which is
   bound to the verifier cookie in the browser that started sign-in. A test checks that token hashes
   of every type are refused.
4. The callback query is parsed with a Zod schema, using `nextPathSchema` from contracts for
   `next`. Each field falls back on its own: a bad `next` becomes "/", a missing or oversized code
   fails the sign-in, and any `error` value fails it. `safeNextPath` lives in
   `server/auth/next-path.ts`, which has no server-only imports, and is exported from `@/server`.
   **Ticket 133 must pass every `next` value it redirects to through `safeNextPath`**, for example
   on /login after the handle is claimed. Passing `next` into the sign-in actions as-is is fine,
   because the server sanitizes it there.
5. The return types in `auth/actions.ts` are now `Result<z.output<typeof …Output>>` from the
   contracts schemas.
6. `toProfile` degrades instead of failing on fields the database accepts but `profileSchema`
   rejects:
   - invalid links are dropped (at most 8 are kept);
   - a display name the contract rejects (only spaces) falls back to the handle;
   - a bad bio or avatar URL becomes null.
   It logs a warning with the profile id and the field names, never the values. Columns the database
   checks exactly still throw, because that would be a schema bug. Tests: the degrade itself, and a
   session loading for a user with a link kind outside the enum.
7. Added tests:
   - A1: a P0001 "invalid: …" from claim_handle comes back with `fields.handle`.
   - A2: avatar paths `${uid}//x.webp`, one containing a newline, `./` and a backslash are refused.
   - A3: `/%5cevil.example` (also `%5C`), a next of more than 500 characters, and non-string next
     values become "/".
   - A4: a plain 400 `AuthApiError` maps to invalid in mapError, and 400 and 401 from getUser mean
     signed out.
   - A6: `avatarPath: null` writes `avatar_path = null` and returns `avatarUrl: null`.

Commits: 494aeac (merge), 7d309da, 23dea39, 173a0b4, 676f9e0, c374c67, 866df1b, plus this handoff.

`pnpm check && pnpm test && pnpm db:test`, exit 0:
```
> stash@ check /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> pnpm -r --parallel typecheck && tsc -p tsconfig.json && eslint . --max-warnings 0
Scope: 4 of 5 workspace projects
apps/web typecheck$ next typegen && tsc -p tsconfig.json
packages/audio typecheck$ tsc -p tsconfig.json
packages/contracts typecheck$ tsc -p tsconfig.json
packages/ui typecheck$ tsc -p tsconfig.json
apps/web typecheck: Generating route types...
apps/web typecheck: ✓ Types generated successfully
packages/ui typecheck: Done
packages/contracts typecheck: Done
packages/audio typecheck: Done
apps/web typecheck: Done
> stash@ test /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> vitest run
 RUN  v5.1.1 /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
 Test Files  10 passed (10)
      Tests  186 passed (186)
> stash@ db:test /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
> vitest run --config supabase/tests/vitest.config.ts
 RUN  v5.1.1 /home/claude/stash/.claude/worktrees/agent-af9b6f778b43f6089
 Test Files  2 passed (2)
      Tests  91 passed (91)
```
The web project now has 6 files and 84 tests. `pnpm run licenses` passes,
`pnpm --filter @stash/web build` succeeds, and no dependencies changed.

