# Policy tests

`pnpm db:test` proves the access table in docs/spec/data-model.md: one test per cell, plus the
state-change and worker functions. Platform lane owns this folder.

It needs a Postgres 16 or 17 server where it can create databases. By default it connects to
`postgres://postgres:postgres@localhost:5432/postgres`; set `DATABASE_ADMIN_URL` to use another.
`pnpm dev` starts Supabase's own Postgres on port 54322, so this also works:

    DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres pnpm db:test

How it works: `global-setup.ts` builds a template database from `shim.sql` (Supabase's roles,
`auth.users` and `auth.uid()`, decision 0005) plus every migration. Each test file clones it.
`db.as(who, sql)` runs one statement as anon, a signed-in user or the service role inside its
own transaction, the way PostgREST does. Seed data is not loaded; tests arrange their own rows.
