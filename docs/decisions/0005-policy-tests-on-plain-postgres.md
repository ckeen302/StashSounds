# 0005 Policy tests run on plain Postgres with a Supabase shim
- Context: `pnpm db:test` must run in CI and on a laptop. The Supabase CLI needs Docker.
- Options: pgTAP through `supabase test db`; Vitest driving SQL against Postgres 16 with a small shim for Supabase's roles, auth.users and auth.uid().
- Choice: The shim (supabase/tests/shim.sql) plus Vitest. Each test runs one statement as anon, a signed-in user or the service role, inside its own transaction, the way PostgREST does.
- Reason: Runs anywhere with one Postgres service; tests are TypeScript like the rest of the Platform lane.
- Consequence: The shim must track the Supabase defaults it imitates. `pnpm dev` still runs the real Supabase stack.
