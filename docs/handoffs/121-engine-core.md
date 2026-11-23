# Handoff 121 Engine core

## Plan (pre-approved by the lead within the ticket and packages/audio/)

Files:
- `packages/audio/src/web-audio.ts`: the small structural slice of the Web Audio API the engine uses
  (`AudioContextLike`, `GainNodeLike`, `BufferSourceLike`, ...). The browser's `AudioContext` satisfies it;
  unit tests pass a fake. No library.
- `packages/audio/src/loader.ts`: `BufferLoader`, a per-URL cache. Fetching may start before the context
  exists (preload on hover); decoding waits for the context. A failed fetch or decode is not cached, so a
  retry fetches again.
- `packages/audio/src/engine.ts`: `WebAudioEngine` replaces `StateOnlyEngine` behind the same `Engine`
  interface. `getEngine()` keeps one instance on `globalThis` (survives client navigation and module
  re-evaluation). `INITIAL_STATE` stays.
  - `unlock()` creates the one `AudioContext` synchronously inside the gesture, then resumes it if suspended
    or interrupted. Never recreated. `play()` calls it too.
  - `play(item)` sets `current` and `loading`, loads, then starts an `AudioBufferSourceNode` through a
    per-voice gain into one master gain. A generation counter drops stale loads (play a, then b).
    `play()` with no argument resumes, or retries the current item after an error.
  - `pause()` stores the position from the audio clock and stops the voice with a few-ms fade.
  - `seek()` clamps (loops wrap), restarts the voice at the new offset if playing, else stores it.
  - `getPositionMs()` = stored offset + (ctx.currentTime - start) * 1000; never state, never timers.
  - Loops play with `loop = true` and `loopEnd = loopSamples / sampleRate`, `durationMs` from the same.
    One-shots and preset demos play once; at their natural end status goes to `paused` at 0.
    Kits and MIDI have no single buffer: they are left for 221/223 (state updates only, no sound).
  - Every failure (no Web Audio, context creation, resume, HTTP error, decode) sets status `error` and
    never throws; play() always resolves.
  - setTempo, setTranspose, setVolume, setQueue, next, previous keep the placeholder's state behaviour;
    setVolume also drives the master gain. Stretch is 122; neighbour preload is 123.
- `packages/audio/test/fake-audio.ts`, `test/engine.test.ts`, `test/loader.test.ts`: tests first, every
  method covered against a fake AudioContext with a hand-advanced clock and a fake fetch.
- `packages/audio/test-page/`: `index.html`, `main.ts` and a dependency-free `serve.mjs` (Node + the
  workspace's TypeScript `transpileModule`) that plays a fixture loop. `pnpm --filter @stash/audio test-page`.

No new dependencies. No contract changes expected. Browser-level timing (time to first sound) is ticket 123.
