# Playbook

> Source: Stash MVP Build Documentation (23 Nov 2026), Tab 1 ("AI agent plan") and Agent playbook. Where this file and the code disagree, raise it with the lead; do not silently pick one.

## AI agent plan

Split the build by directory, not by feature: one lead session fixes the contracts, then four agents work in parallel, each in its own git worktree and each owning folders no other agent may edit. Parallel agents fail when two of them edit the same file, and Claude Code's own guidance is to break work so each agent owns a different set of files.

### Step 0: the lead session, alone, before anything runs in parallel

Run this as a single session in plan mode first, and review the plan yourself. Its output is what makes the parallel work safe.

1. Scaffold the monorepo with the layout in the architecture section.
2. Write CLAUDE.md (contents below) and copy this document into `docs/`, one file per section.
3. Write every Zod schema in `packages/contracts`: item, file, profile, each details shape, each API request and response.
4. Write the full SQL migration and access policies in `supabase/`, with seed data.
5. Put the design tokens and an empty component index in `packages/ui`.
6. Add test fixtures: five loops, three one-shots, two kits, five MIDI files, three Vital presets and two Serum presets that you made yourself.
7. Set up lint, type-check, unit test and end-to-end test commands, and run them in CI on every pull request.

### The four parallel lanes

| Agent | Owns | Builds | Done when |
| --- | --- | --- | --- |
| Platform | `supabase/`, `apps/web/src/server/` | Auth flows, upload-slot and download APIs, queries for items, search, feed, follows, likes, rate limits | Policy tests prove a user cannot read or write another user's private rows; API tests pass against a local database. |
| Pipeline | `apps/worker/` | Queue consumer, audio, kit, MIDI and preset processors, fingerprinting, duplicate check | Every fixture file processes to the expected metadata and preview files; a corrupt file and a ZIP bomb fail cleanly. |
| Audio | `packages/audio/` | Engine, loop player with stretch, one-shot and pad players, MIDI player, sampler for Vital notes, keyboard map | A demo page plays every fixture type; start time is under 300 ms on a throttled connection. |
| Interface | `packages/ui/`, `apps/web/src/app/` | Components, every screen in the design section, the player bar, upload flow | End-to-end tests cover sign-up, upload, publish, search, play, like, follow, download; screens match tokens at desktop and 380 px. |

Migrations stay with the lead; the Platform agent owns the policy tests and the server code. Until the Platform lane lands, the Interface agent builds against mock data generated from the contracts. Because both sides import the same schemas, swapping mocks for real queries is mechanical.

### Rules every agent follows

- Contracts are read-only. Only the lead session changes `packages/contracts` or adds a migration. An agent that needs a change stops and asks.
- Stay in your folders. An edit outside an agent's owned paths fails review.
- Small pull requests. One capability each, with tests, merged by you daily. Long-lived branches are where agent work rots.
- Tests are the definition of done. An agent reports the commands it ran and their output, not a description of what it believes works.
- No new dependencies without a line of justification in the pull request, including the license.

### Which Claude Code mechanism to use for what

| Mechanism | Use it for | Why |
| --- | --- | --- |
| Separate sessions in git worktrees (`claude --worktree <name>`) | The four build lanes | Full isolation of files and context. You steer each lane directly. |
| Subagents | Focused jobs inside a lane: find all callers, write tests for one module, check a library's API | Own context, report back a result, cheaper than a full session. |
| Agent teams | Review and research: three reviewers on one pull request, or competing designs for trending ranking | Still experimental and off by default. The docs suggest 3 to 5 teammates, about 5 to 6 tasks each, and warn of higher token use. |

### Standing reviewers

Define these once as subagent definitions in `.claude/agents/`, read-only, and run them on every pull request.

- Security reviewer: access policies, upload validation, signed-URL lifetimes, ZIP handling, secrets in code.
- Contract reviewer: every API handler and query matches `packages/contracts`.
- Design reviewer: takes screenshots through the end-to-end tests and checks them against the tokens and screen rules.
- Test reviewer: new behavior has a test that fails without the change.

### What goes in CLAUDE.md

- One paragraph on what the product is and who it is for.
- The repository layout and which lane owns which path.
- The exact commands for install, dev, lint, type-check, test and end-to-end test.
- The rules above, word for word.
- Links to the section files in `docs/` for schema, pipeline, playback and design.
- A list of things never to do: commit secrets, disable access policies, add a raw hex color, bypass the upload pipeline.

### Prompt template for starting a lane

```
You are the <lane> agent for this repo. Read CLAUDE.md and docs/<section>.md first.
You own: <paths>. Do not edit anything else. packages/contracts is read-only.
Goal for this session: <one capability>.
Done means: <the specific tests> pass, and you paste the command output.
If you need a contract or schema change, stop and describe it instead of making it.
Plan first, show me the plan, then implement in small commits.
```

## Agent playbook

The agents work like a small studio: one lead who owns the plan and the contracts, four builders who each own folders, four reviewers who only read, and you, who approves plans and merges. Everything they tell each other goes through files in the repository, because agents share no memory.

## How the work flows

*Diagram: ticket flow · 8 steps, 2 loops back*

A plan you reject goes back to the builder before any code exists. A blocking finding from a reviewer sends the work back to the builder, however finished it looks.

## Who does what

Ten roles, one of them human. Each builder runs as its own Claude Code session in its own git worktree, started with `claude --worktree <name>`, which creates an isolated checkout under `.claude/worktrees/` on its own branch.

| Role | Runs as | Decides | Writes to | Never |
| --- | --- | --- | --- | --- |
| You, the owner | A person | Scope, taste, what merges, when a phase is done | Approvals, feedback, new ticket requests | Lets a pull request merge without reading the handoff |
| Lead | One session on the main checkout | Ticket order, contracts, schema, resolving disputes between lanes | `packages/contracts`, `supabase/migrations`, `docs/`, `CLAUDE.md` | Writes feature code inside a lane |
| Platform builder | Worktree `platform` | How queries, policies and server actions are built | `apps/web/src/server`, `supabase/tests` | Touches UI components or the worker |
| Pipeline builder | Worktree `pipeline` | How each file type is analyzed and screened | `apps/worker` | Calls the database with anything but the service role's narrow functions |
| Audio builder | Worktree `audio` | How sound is loaded, scheduled and stretched | `packages/audio` | Renders any UI beyond a bare test page |
| Interface builder | Worktree `interface` | Layout, components, interaction, copy | `packages/ui`, `apps/web/src/app` | Writes data queries or audio code; it calls what the other lanes expose |
| Security reviewer | Read-only subagent | Whether a change is safe to merge | Findings only | Edits code |
| Contract reviewer | Read-only subagent | Whether code matches the shared schemas | Findings only | Edits code |
| Design reviewer | Subagent that can run the screenshot script | Whether a screen meets the design spec | Findings with scores | Edits code |
| Test reviewer | Subagent that can run tests | Whether new behavior is proven | Findings only | Edits code |

Two rules make this work. One writer per folder: if two roles could plausibly edit a path, the lead assigns it to one and records that in `CLAUDE.md`. One designer: only the Interface builder writes anything a user sees, so the product has one visual hand.

## The loop for one ticket

Every piece of work, from the first endpoint to the last polish pass, goes through the same nine steps. A ticket is sized so the whole loop fits in one session: one capability, a handful of files.

1. The lead writes the ticket. A file in `docs/tickets/` with the goal, the owned paths, the contract and spec sections that apply, the acceptance tests, and what is out of scope.
2. The builder plans. In plan mode it reads `CLAUDE.md`, the ticket and the linked spec, then lists the files it will touch, the tests it will add, and anything in the ticket it thinks is wrong.
3. You approve the plan. This takes two minutes and is the cheapest place to catch a wrong turn. If the plan needs a contract change, it goes to the lead first.
4. The builder implements. Tests first wherever the acceptance criteria can be tested. Small commits. It checks the installed version of any library before using it, not its memory of the API.
5. The builder verifies its own work. It runs the lane's checks and, for UI, captures screenshots at three widths. It does not report done on a failing check.
6. The builder writes a handoff note. What changed, the commands it ran with their output, screenshots, what it did not do, and anything that surprised it.
7. The reviewers run. Each reads the diff through its own lens and returns findings marked blocking or advisory. They do not see the builder's reasoning, only the result.
8. The builder fixes blocking findings and re-runs the checks. Advisory findings become new tickets if you agree with them.
9. You merge. The lead updates the board, and if the change affects another lane, adds a line to that lane's next ticket.

Three stop rules apply to every builder. Stop and ask when the ticket conflicts with the spec. Stop and file a request when a contract or schema change is needed. Stop and start a fresh session with the handoff note when the same error has come back three times.

## How agents talk

Agents coordinate through eight kinds of file, all in the repository. A session that starts cold reads them and is caught up; nothing important lives only in a chat window.

| File | Written by | Read by | Holds |
| --- | --- | --- | --- |
| `CLAUDE.md` | Lead | Every session, automatically | What the product is, who owns which path, the commands, the rules |
| `docs/spec/*.md` | Lead | Builders, per ticket | This document, one file per section |
| `packages/contracts` | Lead | Everyone, as imported code | The shape of every item, request and response |
| `docs/tickets/NNN-name.md` | Lead | The assigned builder | One unit of work and its acceptance tests |
| `docs/requests/NNN-name.md` | Any builder | Lead | A requested change to contracts, schema or another lane's code, with the reason |
| `docs/decisions/NNN-name.md` | Whoever decided | Everyone | A choice the spec did not cover, in five lines: context, options, choice, reason, consequence |
| `docs/handoffs/NNN-name.md` | The builder who finished | You, reviewers, the next builder | What changed, proof it works, what is left |
| `docs/board.md` | Lead | You | One line per ticket: number, lane, status, blocker |

### How a cross-lane need is handled

The Interface builder discovers it needs the feed query to return follower counts. It does not edit the query. It writes a request file, mocks the field locally from the contract it is proposing, and carries on. The lead reads the request, updates the contract if it agrees, and adds a ticket for the Platform builder. When that ticket merges, the Interface builder deletes its mock. Nobody waited and nobody edited outside their folders.

## When to use each Claude Code mechanism

- Worktree sessions for the four builders. Add a `.worktreeinclude` file listing `.env.local` so each new worktree gets your local secrets copied in.
- Subagents for the four reviewers and for side jobs inside a lane, such as searching the codebase or reading a library's docs. They work in their own context and return only the result.
- Agent teams only for parallel review or for comparing approaches before a hard decision. The feature is still experimental, costs more tokens, and its own docs steer sequential and same-file work back to a single session.

## The design loop

Agents cannot judge beauty from code. They produce good-looking work when they are given a picture to match, a way to see what they built, and a score to beat. Left without those, they produce the same generic interface every time.

### The ten practices

1. A visual target before any UI code. Mock up five screens first: search rows, loop page, kit page, upload, profile. Save them as images in `docs/design/refs/`. The Interface builder's job becomes matching a picture, which agents do well.
2. One designer. Only the Interface builder writes UI. Other lanes expose data and functions.
3. A gallery page. A route at `/dev/gallery` renders every component in every state: default, hover, focus, active, disabled, loading, empty, error. Most design review happens here, not on full pages.
4. Eyes on every change. The end-to-end tests capture each changed screen at 1440, 1024 and 380 pixels wide. The design reviewer reads the images, not the code.
5. A rubric with numbers. The reviewer scores each screen from 1 to 5 on the seven criteria below. Any score under 4 is a blocking finding with a specific fix.
6. Visual regression. Approved screenshots are committed as baselines. A later change that moves pixels fails the check until someone accepts the new image on purpose.
7. Polish passes as real tickets. Each phase ends with tickets that add nothing: tighten spacing, fix alignment, tune motion, rewrite copy. Good interfaces come from the third pass, so schedule three.
8. Real content only. Fixtures use real waveforms, real producer-style names and real tags. Placeholder text hides layout problems.
9. Tokens enforced by lint. A lint rule rejects raw colors and arbitrary spacing values in components. Drift becomes a failed check instead of a judgment call.
10. Speed counts as design. Time to first sound, scroll smoothness and layout shift have budgets in the build spec and tests that enforce them.

### The rubric

| Criterion | A 5 looks like |
| --- | --- |
| Hierarchy | One thing on the screen is clearly most important, and it is the right thing |
| Density | A laptop screen shows 12 or more result rows without feeling cramped |
| Alignment | Every edge sits on the grid; numbers line up in columns |
| Consistency | The same thing looks the same everywhere; only tokens are used |
| States | Hover, focus, loading, empty and error all exist and look designed |
| Type | Sizes follow the scale; no more than three sizes on one screen region |
| Character | A screenshot with the text blurred is still recognizably this product |

### The ban list

These mark an interface as machine-made, and the design reviewer fails any of them on sight: gradient text, purple-to-blue gradients, glass blur panels, emoji used as icons, a centered headline over three feature cards, drop shadows on everything, oversized rounded corners, placeholder copy, and stock illustrations.

## Quality gates

A change merges only when every gate that applies to it is green in CI. The command names below are the ones the lead sets up in step 0, so every agent and every ticket can refer to them the same way.

| Gate | Command | Fails when |
| --- | --- | --- |
| Types and lint | `pnpm check` | A type error, a lint error, a raw color or arbitrary spacing value in a component, an import across lane boundaries |
| Unit tests | `pnpm test` | Any unit test fails, or a changed file in `packages/audio` or `packages/contracts` has no test |
| Database policies | `pnpm db:test` | A policy test shows one user reading or writing another user's private row |
| Worker tests | `pnpm worker:test` | A fixture file produces the wrong metadata, or a hostile file is not rejected cleanly |
| End-to-end | `pnpm e2e` | A core journey breaks: sign up, upload, publish, search, play, like, follow, download |
| Visual | `pnpm visual` | A screenshot differs from its baseline without the baseline being updated in the same change |
| Accessibility | Runs inside `pnpm e2e` | An automated accessibility scan reports a serious violation on a changed screen |
| Performance | `pnpm perf` | Time to first sound, page weight or layout shift exceeds the budget in the build spec |
| Licenses | `pnpm licenses` | A new dependency has a license outside the allowed list |

### Rules about the gates themselves

- No gate is ever skipped or loosened by a builder. A flaky test is reported in the handoff and fixed in its own ticket.
- The reviewers are a gate too. A blocking finding from any reviewer stops the merge the same way a red check does.
- A hook enforces the basics. Configure a Claude Code hook that runs `pnpm check` when a builder finishes a turn, so type and lint errors are caught before a handoff is written. Confirm the current hook events in the Claude Code hooks reference when setting this up.
- Main is always releasable. If a merge breaks main, the next action for everyone is fixing it or reverting it.

## Your routine and the failure modes

Your job is taste and judgment, not typing. The most valuable thing you do each day is use the product as a producer and say what feels wrong.

### A working day

1. Read the board. See what merged, what is blocked and what is waiting on you.
2. Approve plans. Each waiting builder has a short plan. Approve it, or correct it in a sentence.
3. Review handoffs. Look at the screenshots and the pasted test output before the diff. If the proof is missing, send it back without reading further.
4. Merge what passed. One lane at a time, re-running the checks on main after each.
5. Use it for fifteen minutes. Upload something, audition twenty sounds, follow someone. Write every rough edge as one line.
6. Turn those lines into tickets with the lead, and let it order them.

### When agents go wrong

| Symptom | Usual cause | Fix |
| --- | --- | --- |
| Two builders changed the same file | Ownership of that path was never written down | Lead assigns the path to one lane in `CLAUDE.md`; the other files a request |
| "Done", but it does not work | The ticket had no testable acceptance criteria, or proof was not required | Reject the handoff; add the missing test to the ticket |
| The UI looks generic | No visual target, or the builder never saw its own output | Add reference images; require screenshots; run a polish ticket |
| Styling drifts between screens | Raw values instead of tokens | Tighten the lint rule; move the pattern into `packages/ui` |
| A builder loops on one error | Its context is full of failed attempts | Stop the session; start a new one from the handoff note |
| Code uses an API that does not exist | The agent relied on memory of an older library version | Rule in `CLAUDE.md`: read the installed package's docs or types first |
| Frontend and backend disagree on a shape | Someone bypassed the contracts | Contract reviewer on every change; shapes are imported, never retyped |
| A change quietly weakens security | An access policy was relaxed to make a test pass | Security reviewer blocks any policy change not requested in the ticket |
| Costs climb with little progress | Parallel agents on work that is really sequential | Drop to one session until the dependency is merged |
| Scope grows inside a ticket | The builder "improved" things nearby | Out-of-scope section in every ticket; extras go to a new ticket |

## Files to paste

These are starting versions of the files that make the playbook real. The lead session creates them in step 0; edit the wording to taste, then leave them alone so every agent reads the same rules.

### CLAUDE.md

```markdown
# Stash

Stash is a web app where music producers share loops, one-shots, drum kits, MIDI and
synth presets, hear each one instantly in the browser, and follow each other.
Hip-hop first. Read the relevant file in docs/spec/ before working on anything.

## Layout and ownership
apps/web/src/app          Interface lane      pages and layouts
apps/web/src/server       Platform lane       server actions, queries, route handlers
apps/worker               Pipeline lane       Python worker
packages/audio            Audio lane          browser audio engine
packages/ui               Interface lane      tokens and components
packages/contracts        Lead only           Zod schemas and shared types
supabase/migrations       Lead only           SQL schema and access policies
supabase/tests            Platform lane       policy tests
docs/                     Lead                spec, tickets, decisions, handoffs, board

## Commands
pnpm install              install everything
pnpm dev                  web app, local database, local storage, worker
pnpm check                types and lint
pnpm test                 unit tests
pnpm db:test              database policy tests
pnpm worker:test          worker tests
pnpm e2e                  end-to-end tests
pnpm visual               screenshot comparison
pnpm perf                 performance budgets

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

## Where things are specified
docs/spec/architecture.md   upload pipeline and storage
docs/spec/data-model.md     tables and access rules
docs/spec/build-spec.md     routes, API, worker jobs, audio interface, limits
docs/spec/design-spec.md    tokens, components, signature views
docs/spec/playbook.md       how tickets, reviews and handoffs work
```

### Reviewer definitions

Each goes in `.claude/agents/` as its own file. The tools line is what keeps a reviewer from editing code.

```markdown
---
name: security-reviewer
description: Reviews a change for security problems before merge. Use on every pull request.
tools: Read, Grep, Glob
---
You review one diff for security. You never edit files.

Check, in this order:
1. Access policies. Can any user now read or write a row they do not own? Was any
   policy loosened without the ticket asking for it?
2. Uploads. Is the file type checked from bytes? Are size and count limits enforced?
   Is ZIP handling safe from path traversal and decompression bombs?
3. Signed URLs. Short lifetime, one object each, issued only after an auth check.
4. Input. Is every server action and route validated with a contracts schema?
5. Secrets. Nothing sensitive in code, logs, client bundles or error messages.
6. Rate limits on everything that writes or sends.

For each finding give: file and line, what is wrong, how it could be abused, the fix,
and BLOCKING or ADVISORY. If you find nothing, list what you checked.
```

```markdown
---
name: contract-reviewer
description: Checks that changed code matches packages/contracts. Use on every pull request.
tools: Read, Grep, Glob
---
You check one diff against packages/contracts. You never edit files.

1. Every server action, route handler and query parses input and output with a
   contracts schema. No hand-written duplicate types.
2. The worker's output for each content type matches that type's details schema.
3. No file under packages/contracts or supabase/migrations changed unless the ticket
   is assigned to the lead.
4. No import reaches across lanes except through a package's public entry point.

Report each mismatch with file, line, the schema it should use, and BLOCKING or ADVISORY.
```

```markdown
---
name: design-reviewer
description: Scores changed screens against the design spec using screenshots. Use on every UI change.
tools: Read, Grep, Glob, Bash
---
You review how a change looks. You never edit files.

1. Run pnpm visual to capture the changed screens at 1440, 1024 and 380 wide.
2. Open each image. Compare it with docs/design/refs/ and docs/spec/design-spec.md.
3. Score each screen 1 to 5 on: hierarchy, density, alignment, consistency, states,
   type, character.
4. Check the gallery page for every state of each changed component.
5. Fail on sight anything on the ban list in the playbook.

For every score under 4, name the element, say what is wrong in one sentence, and give
the specific fix (a token, a size, a spacing value). Mark it BLOCKING. Judge the
images, not the code.
```

```markdown
---
name: test-reviewer
description: Checks that new behavior is proven by tests. Use on every pull request.
tools: Read, Grep, Glob, Bash
---
You check whether a change is proven. You never edit files.

1. Read the ticket's acceptance criteria. Map each one to a test. List any with none.
2. Run the lane's test command and paste the result.
3. For each new test, ask whether it would fail if the change were removed. Flag tests
   that assert nothing meaningful.
4. Look for missing edge cases: empty input, oversized input, wrong user, repeat call.

Report gaps as BLOCKING when an acceptance criterion has no test, otherwise ADVISORY.
```

### Prompt: the lead's first session

```
You are the lead for Stash. Read every file in docs/spec/. Work in plan mode first.

Your job in this session is step 0 only. Produce, in this order:
1. The monorepo scaffold in the layout the spec describes, with the commands in CLAUDE.md working.
2. packages/contracts: a Zod schema for every item type, file, profile, each details
   shape, and every request and response in the build spec.
3. supabase/migrations: the schema and access policies from the build spec, with seed data.
4. packages/ui: tokens from the design spec, the lint rule that bans raw values, an
   empty gallery route.
5. A one-command local stack: database, S3-compatible storage, worker, web app.
6. CI running every gate in the playbook.
7. docs/tickets/ for phase 1, one file per ticket from the backlog, using the template.

Show me the plan and the list of contracts before writing code. Do not build features.
Where the spec is silent, write a decision file and tell me.
```

### Prompt: starting a builder on a ticket

```
You are the <lane> builder for Stash. Read CLAUDE.md, then docs/tickets/<NNN>.md and
the spec sections it links.

You own: <paths>. Everything else is read-only for you.
Plan first: files you will touch, tests you will add, anything in the ticket you think
is wrong. Wait for my approval.
Then implement in small commits, tests first where the criteria are testable.
Finish by running <lane checks> and writing docs/handoffs/<NNN>.md with the output pasted in.
```

### Prompt: a polish pass

```
You are the Interface builder. This ticket adds no features.

Screen: <route>. Reference: docs/design/refs/<file>.
1. Capture the screen at 1440, 1024 and 380 wide and look at the images.
2. List every difference from the reference and every rubric criterion you would score under 5.
3. Fix them in order of visibility. Use only tokens and packages/ui components.
4. Capture again. Put before and after images in the handoff.
Stop when the design reviewer scores every criterion 4 or higher.
```

### Template: ticket

```markdown
# <NNN> <title>
Lane: <platform | pipeline | audio | interface | lead>
Depends on: <ticket numbers>

## Goal
One or two sentences on what a user or another lane can do when this is merged.

## Owned paths
## Spec and contracts that apply
## Acceptance criteria
- [ ] Each one checkable by a test or a screenshot
## Out of scope
```

### Template: handoff

```markdown
# Handoff <NNN> <title>
## What changed
## Proof
Commands run and their output. Screenshots for UI.
## Not done
## Surprises and decisions
## Requests filed
```
