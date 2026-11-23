# Handoff 122 Loop player with tempo and key shift

## Plan

Stacked on lane/audio-121 (PR #2), with origin/phase-0/foundations merged in.

Library: `signalsmith-stretch` 1.3.2 (MIT, the version on npm, published 2025-06-27). I read the installed
`SignalsmithStretch.mjs` and README, not memory: `SignalsmithStretch(ctx, options)` resolves to an
AudioWorkletNode with `addBuffers(channels, transfer?)`, `dropBuffers()`, `schedule({output, active, input,
rate, semitones, loopStart, loopEnd})`, `latency()`. The WASM is inlined in the module and the worklet is
built from a blob URL. It has no type declarations, so `src/signalsmith-stretch.d.ts` declares exactly
what the installed version exposes.

What the installed processor does at a loop point decides the design. It reads a window of input
around the play position (its input plus output latency) and fills anything outside its buffers with zeros.
With the loop alone in the buffer, the window at the join would hold silence, a dip at every
repeat. So the engine gives it `[tail pad | loop | head pad]`: the pad before the loop is the loop's own
end and the pad after it is the loop's own start (wrapped, for loops shorter than the pad), with
`loopStart`/`loopEnd` around the middle copy. The window then always sees continuous audio.

Engine (`packages/audio/src`):
- `loop-layout.ts`: pure helpers. `loopFrames(item, buffer)` gives the loop length in decoded frames,
  `round(loopSamples * buffer.sampleRate / item.sampleRate)` capped at the buffer, which is right when
  the context resamples 44.1 kHz to 48 kHz. `paddedLoop(channels, loopFrames, padFrames)` builds the layout above.
- `engine.ts`:
  - Loops at tempo 1 and transpose 0 play on an `AudioBufferSourceNode` with `loop` set to the frame-exact
    loop length (the 121 path; no worklet, no added latency, sample-exact).
  - Stretch loads late: the module is dynamically imported the first time a loop needs a tempo or key
    change (or starts with one), never with the page. One stretch node for the session, reused across
    items, behind its own gain. A failed load is not cached; playback stays on the plain path with
    tempo and key state reset to the original, so state never claims a change you cannot hear.
  - Live change without restarting: a playing plain loop hands over to the stretch at
    `T = now + latency + 20 ms`. The stretch is scheduled to be at exactly the plain voice's position at T,
    and a short crossfade runs at T. Further changes are scheduled on the running stretch with an explicit
    input position. Nothing restarts.
  - Position: a timeline of `{at, pos, rate}` segments on the audio clock, so `getPositionMs()` advances at
    the tempo ratio and wraps on the loop length. Still never state, still no timers.
  - Pause, seek and switching items work on both paths.
- Tests first: `test/loop-layout.test.ts`, and engine tests against a fake stretch node: loaded only on
  need, the handoff position and crossfade, live schedules, position at a changed rate, failure fallback,
  and a check that engine.ts has no static import of the library.

The seamless-loop test (`e2e/perf/seamless-loop.spec.ts`, run by `pnpm perf`). Node has no Web Audio
decoder, so a unit test in node cannot decode the fixture MP3, FLAC or WAV the way a browser does.
The test renders in Chromium's OfflineAudioContext through the engine's own code, which is "offline" in
the spec's sense. For every fixture loop (the five generated loops plus the re-encoded MP3; AIFF is
converted to WAV in the test because Chromium cannot decode AIFF), at 44.1 and 48 kHz:
- Plain path: two passes rendered by the engine must equal the decoded loop twice, sample for sample.
- Stretch path (transpose and tempo set): the engine's looped render must match a reference render of
  the same stretch over the loop laid out three times end to end, with no loop point. Any gap or click
  at the join shows up as a local difference.
- Content check on every render: no RMS dip (gap) and no step larger than the loop's own largest step
  (click) at the join. If an MP3 fails, I file `docs/requests/122-*.md` to change the preview format.
- Handoff: a plain loop switched to the stretch mid-render (OfflineAudioContext.suspend) and a live
  tempo change on the stretch both show no gap and no click at the switch.

Test page: tempo and transpose controls, and an import map for the library, served from node_modules by
serve.mjs. The existing test-page spec gains a live tempo change: position slows to the new rate, status
stays playing, the output keeps sound, and the library is requested only after the change.

Out of scope: queue and preload of neighbours (123), one-shot transpose (221).
