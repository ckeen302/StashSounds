# Request 132 A tablet (800 px) visual project
From lane: interface
For: lead
Blocking ticket: none (PR #12 review, design item 10; a workaround is in place)

## What I need changed
`playwright.config.ts` (lead-owned): add `tablet: 800` to `widths`, so a `visual-tablet` project
runs every screenshot at 800 x 900, and add it to the `visual` aggregate project's
`dependencies`. Then run `pnpm visual:update` (needs Docker) and commit the new
`*-visual-tablet.png` baselines.

## Why
The tablet frame (64 px icon rail, 64 px bar with the progress line and no waveform, the list
without the length column) has its own layout. The design reviewer asked for it to have its own
baselines, like desktop, laptop and phone.

## Workaround in the meantime
`e2e/visual/screens.spec.ts` has a "tablet frame" block. It sets an 800 px viewport and runs only
in the `visual-laptop` project, writing `shell-tablet-rail`, `shell-tablet-top-bar` and
`shell-tablet-list` baselines. When the project lands, remove the `test.use` viewport and the
`test.skip` line so the block follows the project.
