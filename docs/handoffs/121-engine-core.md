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

## What changed
- `packages/audio/src/engine.ts`: `WebAudioEngine` replaces `StateOnlyEngine` behind the unchanged `Engine`
  interface. `getEngine()` keeps the one instance on `globalThis[Symbol.for("stash.audio.engine")]`.
- `packages/audio/src/loader.ts`: `BufferLoader` (fetch once, decode once, never cache a failure).
- `packages/audio/src/web-audio.ts`: structural Web Audio types plus `createBrowserContext()`. Its `return`
  has no cast, so the compiler proves the browser `AudioContext` fits the slice the engine uses.
- `packages/audio/test/`: `fake-audio.ts` (fake context with a hand-advanced clock, fake fetch with hold
  and release), `engine.test.ts` (43 tests), `loader.test.ts` (5 tests). The placeholder's four tests are kept
  with the same assertions, now run against the real engine.
- `packages/audio/test-page/`: `index.html`, `main.ts`, `serve.mjs`; script `test-page` in the package.
  `tsconfig.json` now includes `test-page`.
- `packages/audio/src/index.ts` (the public surface) is unchanged.

Acceptance criteria:
| Criterion | Proof |
| --- | --- |
| Public surface in index.ts does not change | `git diff origin/phase-0/foundations -- packages/audio/src/index.ts packages/audio/src/types.ts` is empty |
| unlock() creates the context on the first gesture; never recreated | "creates no context until unlock, then exactly one", "synchronously inside the gesture", "getEngine ... kept on globalThis"; browser run: 0 contexts before the click, 1 after five plays |
| Failures set status 'error' with retry, never throw | "failures are quiet and recoverable" (HTTP, network, decode, missing Web Audio, refused resume, throwing listener); browser run: the AIFF fixture sets `error` with no page error |
| getPositionMs() reads the audio clock; position is never React state | "position reads the audio clock" (4 tests, including no timers and no notifications as the clock moves) |
| Unit tests with a mocked AudioContext for every method | every `Engine` method appears in engine.test.ts |
| Bare test page plays a fixture loop | `pnpm --filter @stash/audio test-page`; browser run below |

## Proof

`pnpm check`
```
> stash@ check
> pnpm -r --parallel typecheck && tsc -p tsconfig.json && eslint . --max-warnings 0
Scope: 4 of 5 workspace projects
apps/web typecheck$ next typegen && tsc -p tsconfig.json
packages/audio typecheck$ tsc -p tsconfig.json
packages/contracts typecheck$ tsc -p tsconfig.json
packages/ui typecheck$ tsc -p tsconfig.json
apps/web typecheck: Generating route types...
apps/web typecheck: ✓ Types generated successfully
packages/ui typecheck: Done
packages/contracts typecheck: Done
packages/audio typecheck: Done
apps/web typecheck: Done
exit 0
```

`pnpm test`
```
> stash@ test
> vitest run
 RUN  v5.1.1
 Test Files  5 passed (5)
      Tests  146 passed (146)
exit 0
```

`pnpm exec vitest run --project audio --reporter=verbose` (audio project only)
```
 ✓ loader.test.ts > BufferLoader > fetches once per URL and decodes once per URL
 ✓ loader.test.ts > BufferLoader > prefetches bytes without a context and decodes them later without refetching
 ✓ loader.test.ts > BufferLoader > rejects on an HTTP error and does not cache the failure
 ✓ loader.test.ts > BufferLoader > does not cache a failed decode (the bytes are fetched again on retry)
 ✓ loader.test.ts > BufferLoader > swallows a failed prefetch so nothing reaches the UI
 ✓ engine.test.ts > engine interface (kept from the placeholder) > plays, pauses and resumes
 ✓ engine.test.ts > engine interface (kept from the placeholder) > notifies subscribers and stops after unsubscribe
 ✓ engine.test.ts > engine interface (kept from the placeholder) > moves through the queue
 ✓ engine.test.ts > engine interface (kept from the placeholder) > clamps transpose and volume and derives tempo ratio from the loop's BPM
 ✓ engine.test.ts > unlock and the audio context > creates no context until unlock, then exactly one for the session
 ✓ engine.test.ts > unlock and the audio context > creates the context synchronously inside the gesture, before any await
 ✓ engine.test.ts > unlock and the audio context > resumes a context the browser suspended or interrupted
 ✓ engine.test.ts > unlock and the audio context > sets status error and does not throw when Web Audio is missing
 ✓ engine.test.ts > unlock and the audio context > sets status error when resume is refused, and play() retries
 ✓ engine.test.ts > unlock and the audio context > getEngine returns one instance for the session, kept on globalThis
 ✓ engine.test.ts > load and play > loops a loop on loopSamples at sampleRate, not the decoded length
 ✓ engine.test.ts > load and play > plays a one-shot once and returns to paused at 0 when it ends
 ✓ engine.test.ts > load and play > plays a preset's demo audio
 ✓ engine.test.ts > load and play > routes every voice through one master gain to the destination
 ✓ engine.test.ts > load and play > keeps exactly one voice when moving between items
 ✓ engine.test.ts > load and play > a slow earlier load never starts after a later play
 ✓ engine.test.ts > load and play > play of the item already playing does not restart it
 ✓ engine.test.ts > load and play > play() with nothing loaded does nothing
 ✓ engine.test.ts > load and play > kits and MIDI are accepted without sound until their players land (221, 223)
 ✓ engine.test.ts > failures are quiet and recoverable > an HTTP error sets status error, keeps the item, and play() retries
 ✓ engine.test.ts > failures are quiet and recoverable > a network error sets status error, keeps the item, and play() retries
 ✓ engine.test.ts > failures are quiet and recoverable > a decode error sets status error and the retry decodes fresh bytes
 ✓ engine.test.ts > failures are quiet and recoverable > a failed preload is silent and leaves state alone
 ✓ engine.test.ts > failures are quiet and recoverable > a listener that throws does not break the engine or other listeners
 ✓ engine.test.ts > preload > fetches before unlock and play uses those bytes
 ✓ engine.test.ts > preload > decodes ahead once the context exists
 ✓ engine.test.ts > position reads the audio clock > advances with currentTime, freezes on pause and continues on resume
 ✓ engine.test.ts > position reads the audio clock > wraps around the loop length
 ✓ engine.test.ts > position reads the audio clock > is not state: the clock moving notifies nobody
 ✓ engine.test.ts > position reads the audio clock > does not use timers
 ✓ engine.test.ts > pause > stops the voice with a short fade instead of a click
 ✓ engine.test.ts > pause > during loading keeps the item and does not start it when the load lands
 ✓ engine.test.ts > pause > does nothing when idle
 ✓ engine.test.ts > pause > a paused one-shot's ending does not reset it
 ✓ engine.test.ts > seek > while playing restarts the voice at the new offset
 ✓ engine.test.ts > seek > while paused stores the offset for resume
 ✓ engine.test.ts > seek > clamps below zero, wraps on loops and clamps to the end on one-shots
 ✓ engine.test.ts > seek > during loading applies when playback starts
 ✓ engine.test.ts > seek > ignores a non-finite position
 ✓ engine.test.ts > volume and the remaining controls > setVolume drives the master gain, before and after unlock
 ✓ engine.test.ts > volume and the remaining controls > setTempo ignores items without a BPM and non-positive values
 ✓ engine.test.ts > volume and the remaining controls > pads, notes and sounds are safe no-ops until 221 to 224
 ✓ engine.test.ts > volume and the remaining controls > setQueue clamps the start index and an empty queue resets it
      Tests  48 passed (48)
```

`CI=1 pnpm perf` (CI=1 so the web app is built fresh, not reused)
```
> stash@ perf
> playwright test --project=perf
Running 1 test using 1 worker
  1 passed (12.2s)
exit 0
```

`pnpm run licenses`
```
All dependency licenses are on the allowed list.
```

`BASE_REF=origin/phase-0/foundations node scripts/require-tests.mjs`
```
Every changed source file in packages/audio and packages/contracts comes with a test change.
```

Browser run of the test page (headless Chromium through Playwright, a one-off script outside the repo; an
analyser tapped onto the destination measures real output, RMS over 2048 samples):
```
before gesture: contexts = 0
midnight_keys_140bpm_Am.wav {"readyMs":196,"status":"playing","durationMs":6857,"pos":708,"posLater":1219,"rms":"0.0808"}
trap_bells_150_F#m.mp3      {"readyMs":39,"status":"playing","durationMs":6400,"pos":711,"posLater":1210,"rms":"0.0724"}
drill_lead_142.flac         {"readyMs":36,"status":"playing","durationMs":3380,"pos":708,"posLater":1207,"rms":"0.0821"}
rnb_pad_72bpm_Ebmaj.aiff    {"readyMs":65,"status":"error","durationMs":0,"pos":0,"posLater":0,"rms":"0.0000"}
pause paused 41 -> 41 rms 0.0000
seek 3000 + resume {"status":"playing","durationMs":6857,"pos":3299}
4 s later (loop is 6857 ms, so it wrapped) {"status":"playing","durationMs":6857,"pos":453} rms 0.2127
contexts created: 1
warning: [audio] EncodingError: Unable to decode audio data
```
`durationMs` matches `loopSamples / sampleRate` from the manifest for each loop (302400, 282240 and
149070 samples at 44.1 kHz). readyMs is click to `playing` on localhost and is not the
time-to-first-sound measurement; that is ticket 123.

## Not done
- Time stretch and pitch shift: `setTempo` and `setTranspose` update state only, as in the placeholder (122).
- The seamless-loop offline render test (122). Loops already loop on `loopSamples / sampleRate` with
  `loopStart = 0`; 122 owns proving the join and any encoder-delay offset at the start.
- A `pnpm perf` time-to-first-sound check on the test page (123). The ticket did not ask for one, so
  nothing was added under e2e/perf.
- Neighbour preload on setQueue/next/previous (123). `preload()` works: bytes are fetched before the first
  gesture and decoded once the context exists.
- Kits, MIDI and preset notes: `play()` of a kit or MIDI item sets it current with status `idle` and makes
  no sound; `triggerPad`, `noteOn`, `noteOff`, `setSound` are no-ops (221 to 224).

## Surprises and decisions
- The test page needs no bundler: `serve.mjs` transpiles `.ts` on request with the root `typescript`
  (already a workspace dev dependency) and serves only files under `packages/audio/src`, `test-page`
  and the fixture loops named in the manifest. It imports `src/engine.ts`, not `index.ts`, because
  `index.ts` also exports the React binding and the page cannot resolve `react` without a bundler.
- Chromium cannot decode AIFF, so the AIFF fixture loop ends in `error` on the test page. That is fine
  for previews (the worker turns every loop into MP3, ticket 112), and it shows the error path working.
- Status after a one-shot or demo ends on its own: `paused` at position 0, so the next play starts again.
- A context that reports `interrupted` (iOS) or `suspended` is resumed on every play; it is never recreated.
- Stop, pause and seek fade the old voice out over about 5 ms (stopped after 30 ms) and a mid-file start
  fades in, so none of them click. Volume changes ramp with a 10 ms time constant.
- `getPositionMs()` does not subtract output latency. If the playhead looks early on Bluetooth output,
  123 or 135 can subtract `outputLatency`.
- `play()` of the item already playing is a no-op (it does not restart), matching the placeholder.
- No new dependencies.

## Requests filed
None.
