# Request 135 A loop switch on the engine
From lane: interface
For: audio (packages/audio), lead (the engine interface in build-spec.md is lead-owned)
Blocking ticket: none (135 ships with a page-side stand-in)

## What I need changed
`Engine.setLoop(on: boolean): void` and `EngineState.loop: boolean` (default true). With loop off, a
loop plays once to its end, then the engine pauses at position 0 (status `paused`). Both the plain
buffer source (`loop = false`) and the stretch (no `loopStart`/`loopEnd` beyond the end) can do it
on the audio clock.

## Why
The design spec's Transport is "tempo, key, loop, volume", and ticket 135 binds all four to the
engine. The engine has no loop control, so a loop always repeats.

## Workaround in the meantime
`apps/web/src/app/_item/loop-watch.ts`: while loop is off, the frame loop that already draws the
playhead watches for the wrap (a jump back of more than half the loop), then pauses and seeks to 0.
It can let up to one animation frame (about 16 ms) of the next pass sound. Deleted when setLoop lands.
