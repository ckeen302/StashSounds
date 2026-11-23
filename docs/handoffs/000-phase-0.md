# Handoff 000 Phase 0: foundations
Lane: lead. Tickets 001 to 008.

## What changed
- **001 Scaffold.** pnpm workspace (apps/web, packages/contracts, packages/audio, packages/ui), Python worker under apps/worker with uv, TypeScript strict, every command in CLAUDE.md wired.
- **002 Docs.** CLAUDE.md with lane ownership, commands, rules and a never-do list; the build document split into docs/spec/ (six files); four reviewer definitions in .claude/agents/; ticket, handoff, request and decision templates; docs/board.md; the 18 phase 1 tickets in docs/tickets/; a Stop hook that runs `pnpm check` when a builder finishes a turn.
- **003 Contracts.** packages/contracts: enums mirroring the database, limits.json (validated at import), primitives (handles, slugs, keys, peaks, cursors), Result and error codes, per-type details, files and the MIDI notes file, Playable (the audio engine's input), profiles, items, result rows, item page, every action input and output, list queries, worker job payload and result, license summaries, item paths. JSON Schemas generated for the Python worker.
- **004 Database.** First migration with the spec's 15 tables plus the additions in decision 0002, triggers for counts, tags, search and notifications, the state-change functions, the worker's service-role functions, column-level grants and row-level security on every table. Limits enforced in SQL from limits.json (decision 0003). Seed data for local development. Policy test harness on plain Postgres (decision 0005).
- **005 Design system foundation.** packages/ui/src/tokens.ts as the single source; theme.css generated for Tailwind 4 with every default reset so only tokens exist; Inter and JetBrains Mono self-hosted; three lint rules (raw colors, arbitrary values, spacing scale) plus lane import boundaries in eslint.config.mjs; /dev/gallery showing the tokens (noindex, unlinked).
- **006 Fixtures.** 36 synthetic fixtures with exact expected results in fixtures/manifest.json: 5 loops (WAV, MP3, AIFF, FLAC), 3 one-shots, 2 kits, 5 MIDI files, 3 Vital and 2 Serum presets with a demo, 3 duplicate copies (exact, trimmed, re-encoded) and 13 hostile files.
- **007 Local stack.** `pnpm dev` starts Supabase through its CLI, S3-compatible storage (SeaweedFS) standing in for R2 with both buckets, writes .env.local, then runs the worker and the web app.
- **Review round.** The four reviewers ran on the pull request. Every blocking finding is fixed: database-side checks that a direct call could skip, rate limits in the database, one report per person, worker result guards, hidden original paths, profile link and avatar checks, and the wavetable confirmation moved to publish (decision 0008); lint holes and missing tokens, the phone display size and page padding (decision 0009); the missing policy tests plus an access audit of every grant and policy; tests that load the real ESLint config per lane; fixture tests that prove each hostile file is hostile. Screenshots now render in the pinned Playwright container locally and in CI; a new CI job runs `pnpm dev --check` against the full local stack.
- **008 CI.** .github/workflows/ci.yml runs every gate: check, generated-files-current, unit tests, changed-code-has-tests, database policies on Postgres 17, worker tests and lint, end-to-end with the accessibility scan, visual baselines at 1440/1024/380, performance budgets, licenses.

## Proof
All gates, run locally on this branch:
```
$ pnpm check
exit 0
packages/audio typecheck: Done
packages/contracts typecheck: Done
apps/web typecheck: Done
$ pnpm test
exit 0
 Test Files  4 passed (4)
      Tests  102 passed (102)
$ pnpm db:test
exit 0
 Test Files  1 passed (1)
      Tests  76 passed (76)
$ pnpm worker:test
exit 0
19 passed, 1 skipped in 0.07s
$ pnpm e2e
exit 0
  4 passed (6.3s)
$ pnpm visual
exit 0
  6 passed (2.8s)   # in mcr.microsoft.com/playwright:v1.63.0-noble, same as CI
$ pnpm perf
exit 0
  1 passed (6.6s)   # at 4x CPU slowdown
$ pnpm run licenses
exit 0
All dependency licenses are on the allowed list.
$ node scripts/sync-limits.mjs --check
exit 0
limits migration 20261123000001_limits.sql is current
```
Screenshot baselines: e2e/visual/__screenshots__/ (home and gallery at three widths).

## Not done
- **Your own fixture files** (ticket 006 asks for files you made). fixtures/own/ is ready with instructions in fixtures/README.md.
- **Design reference images** (decision 0006). The "Stash: key screens" canvas was not in the PDF. Ticket 131 is blocked until the five frames are in docs/design/refs/.
- **`pnpm dev` infrastructure was not run end to end here.** Docker Hub rate-limited this environment, so the Supabase and storage containers could not be pulled. The web app and worker parts were run. The new CI job (local-stack) runs it on GitHub's runners and is the first real proof. The local-stack CI job found that the pinned MinIO image is gone from Docker Hub, so local storage is now SeaweedFS (decision 0011).
- **Policy tests ran on Postgres 16 locally**; CI runs them on 17 to match Supabase.
- **Worker processing, audio engine, screens**: phase 1 tickets, by design.

## Surprises and decisions
- TypeScript 7 is "latest" on npm but the lint stack supports only up to 6.0, so TypeScript 6.0.3 (decision 0001).
- `pnpm licenses` is a pnpm built-in, so the gate is `pnpm run licenses`. It found two real cases that needed a decision: the font files (OFL) and Next's image library (LGPL, loaded dynamically), recorded in decision 0007.
- The policy tests caught a real bug in the first draft: anonymous visitors could not read published items because a policy helper was not granted to anon.
- Three open reports put an item in the admin queue without hiding it, so three accounts cannot take something down (decision 0002).

- The access audit test found that likes and follows let a user write `created_at`; inserts are now limited to the key columns.
- The Postgres and TypeScript slugs disagreed for letters like ß and ø; the TypeScript side now spells them out the way `unaccent` does, with a parity test.

## Requests filed
None.
