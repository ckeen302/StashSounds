# Stash

Stash is a web app where music producers share loops, one-shots, drum kits, MIDI and
synth presets, hear each one instantly in the browser, and follow each other.
Hip-hop first. Read the relevant file in docs/spec/ before working on anything.

The product is one promise: find a sound, hear it instantly, grab it, and follow the person who
made it. Every MVP feature serves that loop. The people it is for are producers who today hunt
YouTube for sounds "in the style of" an artist.

## Layout and ownership
```
apps/web/src/app          Interface lane      pages and layouts
apps/web/src/server       Platform lane       server actions, queries
apps/web/src/app/api      Platform lane       route handlers (lint applies Platform rules here)
apps/web/src/proxy.ts     Platform lane       session refresh before rendering (Next 16 proxy)
apps/worker               Pipeline lane       Python worker
packages/audio            Audio lane          browser audio engine
packages/ui               Interface lane      tokens and components
packages/contracts        Lead only           Zod schemas and shared types
supabase/migrations       Lead only           SQL schema and access policies
supabase/tests            Platform lane       policy tests
supabase/seed.sql         Lead only           local development data
fixtures/                 Lead only           test files and manifest.json (ticket 006)
e2e/                      Interface lane      journeys, accessibility scan, visual baselines
e2e/perf/audio-*.spec.ts  Audio lane          audio test page checks (pnpm perf)
scripts/, .github/        Lead only           tooling and CI
docs/                     Lead                spec, tickets, decisions, handoffs, board
docs/handoffs/NNN-*.md    The builder who finished the ticket
docs/requests/NNN-*.md    Any builder (new files only)
```
If two lanes could plausibly edit a path, the lead assigns it to one and records it here.
eslint.config.mjs enforces these boundaries as import rules; scripts/eslint-config.test.ts proves it.

## Commands
```
pnpm install              install everything (Node 22, pnpm 10, uv for the worker)
pnpm dev                  web app, local database, local storage, worker (--check: start, probe, exit)
pnpm check                types and lint
pnpm test                 unit tests
pnpm db:test              database policy tests (needs Postgres 16+; see supabase/tests/README.md)
pnpm worker:test          worker tests
pnpm e2e                  end-to-end tests (STASH_E2E_PORT picks the server port; use a free one per worktree)
pnpm visual               screenshot comparison in the pinned Playwright container (needs Docker)
pnpm visual:update        rewrite screenshot baselines in the same container; commit them with the change
                          (no Docker? push to visual-update/<name> and download the CI artifact)
pnpm perf                 performance budgets
pnpm run licenses         dependency license check (plain `pnpm licenses` is a pnpm built-in)
```
Generators (lead only): `pnpm --filter @stash/contracts gen` (JSON Schemas for the worker),
`pnpm --filter @stash/ui gen` (theme.css from tokens), `node scripts/sync-limits.mjs` (limits
migration), `python3 scripts/gen-fixtures.py` (synthetic fixtures).

## Rules
1. Edit only the paths your lane owns. For anything else, write docs/requests/NNN-name.md.
2. packages/contracts and supabase/migrations change only through the lead.
3. Import shapes from packages/contracts. Never retype them.
4. Before using a library, read the installed version's types or docs. Do not rely on memory.
5. Plan first. Wait for approval before editing.
6. Tests are the definition of done. Paste the command output in your handoff.
7. UI uses tokens and components from packages/ui. No raw colors, no arbitrary spacing.
8. No new dependency without its license and a one-line reason in the handoff.
9. If the same error returns three times, stop and write a handoff describing it.
10. Never commit secrets, loosen an access policy, skip a failing check, or store an
    upload without sending it through the worker.

Stop rules: stop and ask when the ticket conflicts with the spec; stop and file a request when a
contract or schema change is needed; stop and start a fresh session with the handoff note when
the same error has come back three times.

## Never
- Commit secrets or `.env*` files.
- Disable row-level security or loosen an access policy to make a test pass.
- Add a raw hex color, rgb() value or arbitrary Tailwind value in a component.
- Bypass the upload pipeline: every stored file goes through the worker.
- Skip, quarantine or loosen a quality gate. A flaky test is reported in the handoff.
- Use Essentia (AGPL) or link Vital's GPL code into the worker process.

## How a ticket runs
docs/spec/playbook.md has the full loop. In short: the lead writes docs/tickets/NNN-name.md;
the builder plans in plan mode and waits for approval; implements tests-first in small commits;
runs its lane's checks; writes docs/handoffs/NNN-name.md with the command output; the four
reviewers in .claude/agents/ run; blocking findings are fixed; the owner merges.

Lane checks: Platform `pnpm check && pnpm test && pnpm db:test`. Pipeline `pnpm worker:test`.
Audio `pnpm check && pnpm test && pnpm perf`. Interface `pnpm check && pnpm e2e && pnpm visual`.

## Where things are specified
```
docs/spec/overview.md       product scope, stack, phases, risks
docs/spec/architecture.md   upload pipeline and storage, playback
docs/spec/data-model.md     tables and access rules
docs/spec/build-spec.md     routes, API, worker jobs, audio interface, limits, tickets
docs/spec/design-spec.md    tokens, components, signature views
docs/spec/playbook.md       how tickets, reviews and handoffs work
docs/decisions/             choices the spec did not cover
docs/board.md               one line per ticket
```
