# Request 131 A motion token for the loading ring's turn
From lane: interface
For: lead
Blocking ticket: none

## What I need changed
packages/ui/src/tokens.ts: add the loading ring's rotation period to `motion`, for example
`ring: 800` (ms for one full turn, linear, infinite), and if theme-css.ts should carry it, emit
`--animate-ring: stash-spin 800ms linear infinite` with the keyframes so components can use a
generated `animate-ring` utility.

## Why
The design spec allows exactly two looping motions: the loading ring and the logo's loading state.
Neither has a duration in the motion table (it lists transitions of 80 to 200 ms only), and theme.css
resets `--animate-*`, so Tailwind's `animate-spin` does not exist. The ring is used by Button
(loading), Play button (loading), Progress steps (active) and Uploader card (pending follow).

## Workaround in the meantime
packages/ui/src/components.css defines `@keyframes stash-spin` and an `animate-ring` utility at
800 ms, stopped under reduced motion. packages/ui/test/components-css.test.ts allows 800 ms as the
one named exception (`RING_TURN_MS`) beside the motion tokens; when the token lands, the test and
the utility read it from tokens.ts and the exception goes.
