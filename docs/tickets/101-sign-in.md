# 101 Sign-in by email link, Google and Discord; profile and account rows; handle claim
Lane: platform
Depends on: 004

## Goal
A visitor can sign in with an email link, Google or Discord, and a new user claims a handle before doing anything else. Other lanes get a typed session helper.

## Owned paths
apps/web/src/server/, supabase/tests/

## Spec and contracts that apply
- build-spec.md: Routes and screens (/login), API surface (updateProfile, claimHandle), Conventions
- data-model.md: profiles, accounts, claim_handle
- contracts: claimHandleInput/Output, updateProfileInput/Output, profileSchema, accountSchema, errorCodeSchema

## Acceptance criteria
- [ ] Supabase server and browser clients in apps/web/src/server/supabase/ with env validated by a Zod schema
- [ ] The single action wrapper (session check, contracts validation, rate limit hook, Result with contracts error codes) with unit tests for each error code
- [ ] `getSession()` / `requireUser()` helpers returning profile and account, `null` profile meaning handle not yet claimed
- [ ] claimHandle and updateProfile actions; Postgres `P0001` errors map to the code prefix in the message
- [ ] Unit tests: wrong user, unauthenticated, invalid handle, reserved handle, taken handle
- [ ] `pnpm check && pnpm test && pnpm db:test` pass

## Out of scope
- Sign-in screens (133)
- Avatar upload
