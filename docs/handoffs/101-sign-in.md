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
