# Handoff 123 Preload, queue, next and previous; time-to-first-sound test

## Plan

Stacked on lane/audio-122 (PR #7), with origin/phase-0/foundations merged in. No new dependencies.

Engine (`packages/audio/src`):
- **Preload:** `preload()` already fetches, and decodes once the context exists (121). This ticket proves
  that `play()` of a preloaded item makes no request: the network can be gone and it still plays.
- **Neighbours:** after `setQueue`, `next` and `previous`, the engine preloads the queue neighbours of
  the current index (index + 1 and index - 1). It starts them only once the current item has loaded, so
  on a slow connection they never compete with the item the person is waiting to hear. Neighbour failures
  are silent.
- **Memory:** a byte budget for decoded buffers in `BufferLoader` (96 MB of PCM, least recently used
  first out). Without it, neighbour preload over an endless list would keep every decoded preview
  (an 8 s stereo loop is about 3 MB at 48 kHz). An evicted item simply loads again. Raw prefetched bytes
  are capped by count (32).
- `prefetch` returns a promise that never rejects, so the engine can chain "current first, then
  neighbours" without a timer.

Tests first: engine and loader unit tests against the fakes. They cover: play without network after a
preload, neighbours fetched only after the current item has loaded, both directions, the ends of the
queue, silent failures, and eviction order.

Time to first sound (`e2e/perf/audio-first-sound.spec.ts`, run by `pnpm perf`, the lane's
`e2e/perf/audio-*.spec.ts` path):
- **What is measured:** from the click on the test page's play button (`event.timeStamp`) to the
  moment the first non-silent sample is due at the output.
- **How the output side is timed:** a tap on the destination (a ScriptProcessor, created synchronously
  so it cannot miss the start) finds the first sample above -80 dBFS on the audio clock.
  `getOutputTimestamp()` maps that onto the same performance clock as the click.
- **Fixture:** the MP3 fixture loop (`trap_bells_150_F#m.mp3`, 206 KB at 256 kbps), because previews are
  MP3. The browser cache is disabled and each run gets a fresh page and audio context.
- Scenarios, budgets from `limits.json` (`firstSoundMsFast` 300, `firstSoundMsThrottled` 800):
  - **Fast:** no throttling, nothing preloaded. Must be < 300 ms.
  - **Throttled:** CPU 4x (the same mid-range phone as `budgets.spec.ts`) and a 4G-class network
    (9 Mbps down, 1.5 Mbps up, 150 ms latency), nothing preloaded. Must be < 800 ms.
  - **Throttled and preloaded:** a slower network (1.6 Mbps, 562 ms latency), with the preview fetched
    on hover, as list rows will. Must be < 800 ms, with no request after the click.
  - The spec sets no network profile, so these are my choice; I record it for the lead to confirm.
- The test page gains a `?loop=<file>` parameter, so a run can preselect a fixture without the
  selection itself preloading it.

Out of scope: keyboard map (225).

## What changed

Branch `lane/audio-123` is stacked on `lane/audio-122`, with `origin/phase-0/foundations` merged in, and `lane/audio-122` merged forward after the PR #7 review round (a9cdadb).

- **Tests first** (0939c21): `packages/audio/test/engine-queue.test.ts` (new, 11 tests) and new cases in `test/loader.test.ts`. They failed until the next two commits.
- **`src/loader.ts`** (2326d2f):
  - `BufferLoader` takes optional `LoaderLimits`. Decoded PCM is capped at 96 MB by default, least recently used out; a hit moves an entry to the back. The buffer just decoded is never evicted, even when it alone is over budget.
  - Raw prefetched downloads are capped at 32, oldest out.
  - `prefetch()` returns a promise that never rejects.
- **`src/engine.ts`** (b14db45):
  - `preload()` goes through `warm(item)`, which resolves when the item is in, or has failed, and never rejects.
  - When `play()` has loaded the current item, `warmNeighbours()` preloads queue index + 1, then index - 1. It does this only if the current item is the queue's item at `queueIndex`, so an item played from outside the queue preloads nothing.
  - `setQueue()` warms the start item first, then its neighbours, unless the queue was replaced meanwhile.
  - `next`/`previous` go through `play()`, so they get the same "current first, then neighbours" order.
- **`test-page/main.ts`** (46c3826): `?loop=<file>` preselects a fixture without firing `change`, so nothing is preloaded before the click.
- **`e2e/perf/audio-first-sound.spec.ts`** (46c3826): time to first sound, as planned above. Each scenario does three cold runs, each in a fresh browser context with the cache disabled.

No new dependencies. Ticket criteria:
- [x] `preload()` fetches and decodes; `play()` of a preloaded item starts without network. Unit tests: the network is switched to errors after the preload, and the item still plays with one fetch and one decode. Browser: the slow, preloaded scenario makes 0 requests after the click.
- [x] `setQueue`/`next`/`previous` preload the neighbour (unit tests, including the order and the waiting).
- [x] `pnpm perf` measures time to first sound on the test page: under 300 ms fast and under 800 ms throttled (numbers below).

## Proof

`pnpm check` (exit 0)
```
Scope: 4 of 5 workspace projects
apps/web typecheck$ next typegen && tsc -p tsconfig.json
packages/audio typecheck$ tsc -p tsconfig.json && tsc -p tsconfig.entry.json
packages/contracts typecheck$ tsc -p tsconfig.json
packages/ui typecheck$ tsc -p tsconfig.json
apps/web typecheck: ✓ Types generated successfully
packages/ui typecheck: Done
packages/contracts typecheck: Done
packages/audio typecheck: Done
apps/web typecheck: Done
```
`pnpm test` (exit 0; the audio project alone is 111 tests)
```
 Test Files  9 passed (9)
      Tests  212 passed (212)
```
`CI=1 pnpm perf --reporter=list` (exit 0)
```
first sound fast, cold: 102 ms
first sound fast, cold: 82 ms
first sound fast, cold: 92 ms
  ✓   1 [perf] › e2e/perf/audio-first-sound.spec.ts:138:1 › first sound on a fast connection, nothing preloaded: under 300 ms (1.0s)
first sound throttled, cold: 440 ms
first sound throttled, cold: 431 ms
first sound throttled, cold: 429 ms
  ✓   4 [perf] › e2e/perf/audio-first-sound.spec.ts:148:1 › first sound throttled (CPU 4x, 4G), nothing preloaded: under 800 ms (2.0s)
first sound slow, preloaded on hover: 121 ms, requests after click: 0
first sound slow, preloaded on hover: 147 ms, requests after click: 0
first sound slow, preloaded on hover: 110 ms, requests after click: 0
  ✓   7 [perf] › e2e/perf/audio-first-sound.spec.ts:157:1 › first sound on a slow connection after a hover preload: under 800 ms and no request after the click (6.3s)
  ✓  33 [perf] › e2e/perf/budgets.spec.ts:14:3 › / stays inside the page budgets (1.3s)
  34 passed (29.7s)
```
Stability: I ran `--repeat-each=3` of the first-sound spec, plus one more full run before it. That is 12 runs per scenario, and all of them passed:

| Scenario | Range |
| --- | --- |
| fast, cold | 83 to 122 ms |
| throttled, cold | 423 to 470 ms |
| slow, preloaded | 102 to 147 ms, 0 requests after the click every time |

`pnpm run licenses`: All dependency licenses are on the allowed list.
`BASE_REF=origin/phase-0/foundations node scripts/require-tests.mjs`: Every changed source file in packages/audio and packages/contracts comes with a test change.

Flaky once, not the code: my first full `pnpm perf` on this branch failed `budgets.spec.ts` with "compressed script bytes before audio" (242933 > 204800). The cause was another worktree's session, which had `next start --port 3100` running at the same moment (`EADDRINUSE` in the log). So the budget test measured that session's build. Once its server had exited, the rerun above passed.

## Not done
- **Keyboard map:** out of scope (225).
- **CI container:** I have not run the first-sound spec in the CI Playwright container (`mcr.microsoft.com/playwright:v1.63.0-noble`), because there is no Docker here. CI's first run will show its numbers. The throttled case has about 330 ms of headroom.
- **Real preview hosting:** the numbers come from a local server, the test page server on 127.0.0.1, with CDP shaping the network. A run against real storage and CDN latency belongs with 135 or the item page.

## Surprises and decisions
- **Network profiles: chosen by me, accepted by the lead.** The lead also accepted the timing method below. The spec says only "fast" and "throttled".
  - Fast: no shaping.
  - Throttled: CPU 4x, the same as `budgets.spec.ts`, with 9 Mbps down, 1.5 Mbps up and 150 ms latency, which is 4G-class.
  - Preloaded case: a slower profile (1.6 Mbps, 562.5 ms latency) to show that a hover preload makes the click independent of the network.

  **A cold click on the slow profile is out of the budget by design** (lead's decision). The 562 ms latency plus a 206 KB download at 1.6 Mbps comes to about 1.6 s before any audio can play. That case is covered by preloading: rows preload on hover and focus, and the preloaded scenario above stays under 800 ms with no request after the click.
- **How the timing is taken:**
  - The output side uses a ScriptProcessor tap on the destination and `getOutputTimestamp()`. It takes the later edge of each sample, so it can overstate the time, by at most one 256-frame block (about 6 ms), and never understates it.
  - ScriptProcessor is deprecated but still in Chromium. An AudioWorklet tap would need its own module and could start too late to catch the first block.
  - The click side is the `click` event's `timeStamp`, taken in a capture listener.
- **`?loop=` instead of selecting in the UI:** selecting a fixture fires `change`, which preloads it. A cold run must not preload, hence the URL parameter. The hover scenario uses the page's own `pointerenter` preload, as list rows will.
- **Neighbour preload decodes, it does not only fetch,** when the context exists. That costs CPU while the current item plays, which is fine for previews (a few ms each) and is what lets `next` start without decode latency. Before the first gesture it only fetches.
- **Memory budget numbers:** 96 MB of decoded PCM is about 30 eight-second stereo loops at 48 kHz. 32 raw downloads is about a page of results. Both stay as the loader's constructor defaults. The real ceiling, counting everything, is in the review round below.
- **Merged forward from 122:** the PR #7 fixes affect this ticket in two ways.
  - A loop switch while stretched now waits for the old fade, about 30 ms, before swapping the stretch's buffers. That is added only when the current item is stretched; the plain path is unchanged.
  - The test page now loads `limits.json` through its import map, so a page load makes one extra small request. It is not a fixture request, so it does not affect the "no request after the click" count.

## Requests filed
None.

## Review round (PR #10)

There were no blockers. I took all eight advisories in one round on `lane/audio-123`, tests first:
- 8c3323e: tests. They fail without the next commit, except the neighbour-order test (5) and the outside-queue test (6), which pin down behaviour that already held.
- 6f98dc8: loader and engine.
- 0e119a3: the first-sound spec.

1. **Dropped downloads are aborted, and background downloads are limited.**
   - Each download has its own `AbortController`. When the 32 cap drops a download that is in flight, it is aborted; when it drops one that is still waiting, that one never starts.
   - `play()` of another item calls `loader.cancel()` on the download it replaces, which aborts it if it has not finished. A decoded buffer is kept.
   - Hover and neighbour preloads run four at a time (`maxBackground`, a constructor default). The newest waiting one goes next, because it is the row the person reached last.
   - A download for the item being waited for starts at once. If it was waiting in the background queue, it is taken out of the queue and the cap can no longer drop it.
   - Test: 40 hovers, one per task, all held. At most 4 are in flight at any time. Rows 0 to 3 are aborted when rows 32 to 35 take their slots, and rows 4 to 7 are dropped before they start. As slots free up, rows 39, 38, 37 and 36 go out in that order. In total there are 36 requests, and each of the 32 kept rows is fetched once. Loader tests cover the same rules one by one.
2. **The playing item is pinned.** `loader.pin(url)` is set on every `play()` of a new item. The pinned URL is never evicted and never dropped by the cap, so the current item is never decoded twice. Tests:
   - Loader: the oldest entry is pinned, and B is evicted in its place.
   - Engine: a 77 MB item plays, a 38 MB one is preloaded, and the playing item is then warmed again by `setQueue`. It needs one request and is not decoded again.

   **The real memory ceiling,** at 48 kHz stereo, float32:

   | Part | Size |
   | --- | --- |
   | Decoded PCM, resolved entries | up to 96 MiB (100.7 MB) |
   | Raw downloads not yet decoded | up to 32 × the largest preview |
   | The stretch's padded copy of the current loop, in the worklet | one copy |

   - **Largest preview** (from `limits.json`): a 60 s loop at 128 kbps is 0.96 MB. So the raw downloads come to about 31 MB. These bytes are held only before the first gesture, or while in flight; after that they go straight to the decoder.
   - **Stretch copy:** for a 60 s loop with 1 s pads, (60 + 2) × 48000 × 2 × 4 = 23.8 MB. Its source buffer is the decoded entry already counted. The copy is transferred to the worklet, not duplicated, and the old copy is dropped before a new one is added.
   - **Steady-state worst case:** about 100.7 + 31 + 23.8 ≈ 156 MB.
   - **Above that, for a moment:** buffers still decoding are counted only once they resolve. A decoded 60 s preview is 23 MB, and up to five can be decoding at once (four background and one foreground), so the peak can be higher. A 96 kHz output device doubles the PCM figures.
   - **No byte cap on a response:** a preview far larger than the limits would be read in full. The worker writes the previews, so this is only a defence against a misconfigured bucket.
3. **Fetches are restricted.**
   - Every request goes out with `{ credentials: "omit", signal }`.
   - `isAllowedPreviewUrl` allows `https:` everywhere, and `http:` only for `127.0.0.1` and `localhost` (the test page and dev). Every other URL is refused before any request: `ftp:`, `data:`, `blob:`, `javascript:`, `file:`, relative URLs, `http://127.0.0.2` and `http://localhost.example.com`.
   - A refused `play()` ends in status `error`. A refused `preload` is silent.
   - Tests: loader tests for both lists, and an engine test for `play()`.
4. **setQueue ordering.**
   - If an item is loading, `setQueue` waits for that load to settle before it warms anything.
   - It then warms the start item.
   - It then warms the neighbours, but only while the queue is unchanged and the current item is `items[queueIndex]` (or there is no current item).
   - Tests:
     - `setQueue` during a held load: nothing else is requested until it lands, then only the start item.
     - `play(x)` from outside the queue while the start item loads: no neighbours are fetched.
5. **Neighbour order.** After `next()`, with neither neighbour cached (a's first fetch failed), the requests are c then a.
6. **Outside-queue guard.** `setQueue([a,b,c],1)` with b held, so c is not yet requested. Then `play(x)`, then release b: c and a are never requested.
7. **Silent neighbour failures after `unlock()`.** One neighbour fails to fetch (a) and one fails to decode (c). There are two decodes (b, and c's failed one), the listener is never called, and the status stays `idle`.
8. **First-sound assertions.**
   - Every scenario asserts `ms > 0`. The throttled cold run also asserts `ms > 150`, the profile's latency.
   - Cold runs now press Enter on the focused button. A mouse click moves the pointer over the button first, and the page preloads on `pointerenter`. So the earlier cold runs started the download a few milliseconds early.
   - Cold runs assert from resource timing that exactly one preview download ran and that none started before the click's `timeStamp`. The preloaded run asserts that its one download started before the click.
   - **CPU throttling does not reach decoding or the audio thread.** `Emulation.setCPUThrottlingRate` slows the renderer's main thread. `decodeAudioData` runs on its own decoder thread, and audio renders on the real-time audio thread, so neither is slowed. On a real mid-range phone, decoding the 206 KB preview takes longer than here. The throttled case keeps about 330 ms of headroom for that.

### Lane check after the round

`pnpm check` (exit 0)
```
packages/audio typecheck$ tsc -p tsconfig.json && tsc -p tsconfig.entry.json
packages/ui typecheck: Done
packages/contracts typecheck: Done
packages/audio typecheck: Done
apps/web typecheck: Done
```
`pnpm test` (exit 0; the audio project alone is 128 tests)
```
 Test Files  9 passed (9)
      Tests  229 passed (229)
```
`CI=1 pnpm perf --reporter=list` (exit 0)
```
first sound fast, cold: 122 ms
first sound fast, cold: 92 ms
first sound fast, cold: 91 ms
  ✓   1 [perf] › e2e/perf/audio-first-sound.spec.ts:154:1 › first sound on a fast connection, nothing preloaded: under 300 ms (1.5s)
first sound throttled, cold: 434 ms
first sound throttled, cold: 476 ms
first sound throttled, cold: 455 ms
  ✓   4 [perf] › e2e/perf/audio-first-sound.spec.ts:166:1 › first sound throttled (CPU 4x, 4G), nothing preloaded: under 800 ms (2.2s)
first sound slow, preloaded on hover: 107 ms, requests after click: 0
first sound slow, preloaded on hover: 108 ms, requests after click: 0
first sound slow, preloaded on hover: 116 ms, requests after click: 0
  ✓   8 [perf] › e2e/perf/audio-first-sound.spec.ts:179:1 › first sound on a slow connection after a hover preload: under 800 ms and no request after the click (5.8s)
  34 passed (29.3s)
```
`--repeat-each=3` of the first-sound spec: 9 passed, 9 runs per scenario.

| Scenario | Range |
| --- | --- |
| fast, cold | 82 to 125 ms |
| throttled, cold | 434 to 465 ms |
| slow, preloaded | 105 to 147 ms |

`pnpm run licenses`: All dependency licenses are on the allowed list.
`BASE_REF=origin/phase-0/foundations node scripts/require-tests.mjs`: Every changed source file in packages/audio and packages/contracts comes with a test change.

Note: two `pnpm perf` attempts during this round never reached the tests. Each time, another worktree's session was running its own `next start --port 3100` (for its visual run). Playwright refused to reuse that server ("is already used"). The run above was started once that server had exited.

## Round for ticket 135 (requests from interface-135)

Branch `lane/audio-123`, with `origin/phase-0/foundations` merged in first (c4dd00c; it brought `STASH_E2E_PORT` and the regenerated fixtures). No new dependencies.

### 1. Time stretch in the production build (request 135-stretch-in-production-build), blocking for the demo

**Cause, confirmed in a real chunk.** I read a `next build` chunk (Next 16.4.6, Turbopack) from a worktree that had one. The Emscripten factory inside signalsmith-stretch reads the free variable `process`. Turbopack replaces that with its process polyfill, imported at module scope: `var I,g=A.i(17559)` ... `"object"==typeof g.default`. The library then stringifies the factory into the worklet with `` `(${registerWorkletProcessor})((_scriptName=>${Module})(),…)` ``, and inside the worklet `g` does not exist. Mangling alone is not the trigger: the library minified on its own by SWC still works (I measured 1.997x). It is the bundler's module-scope binding.

**Fix (8da0de1, tests first in 6203d98):**
- `createBrowserStretch(ctx, moduleUrl = STRETCH_WORKLET_PATH)` sets `SignalsmithStretch.moduleUrl` before the first node. The library reads it before it falls back to a Blob. The worklet then runs the unminified file, and only the main-thread half runs from the bundle.
- `STRETCH_WORKLET_PATH` is `/worklets/signalsmith-stretch-1.3.2.mjs`, from `STRETCH_VERSION` in `src/web-audio.ts`. A unit test holds the version equal to the installed package.
- `@stash/audio/stretch-worklet-file` is a new package export (plain Node ESM plus `.d.mts`). It exports `stretchWorkletFile`, the absolute path of the installed `SignalsmithStretch.mjs`, and the same `STRETCH_WORKLET_PATH`. It is for the web app's build-time copy. The test page serves the file at that path, so every perf spec now runs the stretch through `moduleUrl`.
- **Deadline:** `loadStretch` and `node.latency()` each have 3000 ms (`EngineDeps.stretchTimeoutMs`). On expiry the existing fallback runs: the loop plays on the plain path and state returns to tempo 1, key 0. A node that arrives late is disconnected, and the next change tries again.

**Web app (request 135-serve-stretch-worklet, for the lead):**
- Copy `stretchWorkletFile` to `apps/web/public/worklets/signalsmith-stretch-1.3.2.mjs` before `next build` and `next dev`. Use the path from `STRETCH_WORKLET_PATH`, and gitignore the copy.
- Next serves `.mjs` as `application/javascript`, which `addModule` accepts.
- Until this lands, the built app falls back after 3 s instead of hanging. The stretch is still not heard.

**Tests:**
- `packages/audio/test/stretch-worklet.test.ts`:
  - `addModule` is called with the served path, never a `blob:`.
  - The helper's path and file match the installed library.
- `engine-stretch.test.ts`, "a stretch that never answers" (5 tests): a load or `latency()` that never settles, a late node, and the 3000 ms default.
- `e2e/perf/audio-stretch-minified.spec.ts` (new):
  - The test page gets the library as the bundle has it: `process` read through an opaque module-scope binding, then minified with apps/web's own SWC (`next/dist/build/swc`, read, not changed).
  - Test 1 requires the playhead at 2x after a change to 280 BPM, sound at the output, no processor error, and the worklet loaded from `/worklets/…`.
  - Test 2 drops every message the worklet sends, so it never says it is ready. It requires the fallback to tempo 1 at 2900 to 3500 ms, timed in the page from the state change, then playback at 1x.

Before the fix, both perf tests fail, with the production symptom:
```
playhead at 0.998x after a change to double tempo
  ✘  2 [perf] › e2e/perf/audio-stretch-minified.spec.ts:162:1 › with the library minified as in the production build, a tempo and key change is heard (2.4s)
  ✘  1 [perf] › e2e/perf/audio-stretch-minified.spec.ts:186:1 › a stretch worklet that never says it is ready falls back to the original tempo and key within 3 s (6.5s)
    Error: playhead at double speed: the stretch took over
    Received:   0.9982583982067941
    Error: the tempo falls back to the original
    Received: 2
```
That is: state says tempo 2 while the loop plays at 1x, and a worklet that never answers holds tempo 2 forever.

Not done here: the e2e journey `e2e/journeys/loop-page.spec.ts` "at double tempo the loop really plays twice as fast" stays `test.fail()` on lane/interface-135 until the web app serves the file. It is not in my lane.

### 2. Seek fade-out on dusty_soul (eeb512f)

It failed here too, with the same number (fadeOut 0.2375). The engine was right; the measure was wrong.
- **Cause:** the regenerated `dusty_soul_90_Dmin.wav` falls to a quarter of its level within 2 ms of the seek point by itself. So rms(1 ms after) / rms(1 ms before) also measured the loop's own envelope.
- **New measure:** the 1 ms after the seek, divided by the same 1 ms of an identical render with no seek. That reads 0.97 on dusty_soul.
- **Threshold:** still > 0.5. The check now also requires < 1 (it really fades), and requires the two renders to match up to the seek (`before` ≈ 1, to 3 places).
- **Negative control:** I temporarily replaced the stretch fade with a hard cut. Every fixture then read `fade out 0.00` and all 7 failed. The engine was restored before committing.

### 3. Loop switch (request 135-engine-loop-switch; tests 3232b2a and 456a509, engine 95e8151)

`Engine.setLoop(on)` and `EngineState.loop`, default true.
- **Loop off:** the end of the pass playing now is placed on the audio clock. The voice's gain fades (5 ms) from the loop end. A plain source stops 30 ms later, and its `onended` pauses at 0. The stretch is told `active:false` only once it is silent.
- **Why the stretch gets only a fade:** the installed worklet keeps one pending change. Every `schedule` drops all changes at or after the current time (`'outputTime' in objIn` is never true, so it uses `currentTime`). A stop sent at once would drop a start that is still waiting. Unit tests require that nothing is sent after a pending start.
- **The end moves with playback:** a seek, a resume, a handoff or a tempo change places it again.
- **Switching back on before the end:** on the stretch, the fade is taken back. On the plain path, a second source takes over from sample 0 exactly at the loop end, because a stopped source cannot be restarted. Switched on too late, the item starts over from 0.
- One-shots are unaffected.
- **Perf:** a new `renderLoopOff` in seamless.ts, run on two fixtures for each path:
  - The plain pass is sample-exact (maxDiff 3.58e-8).
  - Silence from 40 ms after the end, below 3e-6 rms, including the WAV with a 0.75 s tail past the loop.
  - The state is paused at 0.
- **build-spec.md** needs two lines: request 135-build-spec-loop-switch, for the lead.
- `EngineState.loop` is a required field. On lane/interface-135, `apps/web/src/app/_shell/now-playing.test.ts` builds an `EngineState` literal, so it needs `loop: true` when the branches meet.

### Requests filed
- `docs/requests/135-serve-stretch-worklet.md` (lead): copy the worklet file into public/ at build and dev time.
- `docs/requests/135-build-spec-loop-switch.md` (lead): `setLoop` and `loop` in the engine interface.

### Lane check after the round
`STASH_E2E_PORT=3123 pnpm check && pnpm test && pnpm perf`, exit 0.

`pnpm check`
```

> stash@ check /home/claude/stash/.claude/worktrees/agent-ac6da61f7773dd06e
> pnpm -r --parallel typecheck && tsc -p tsconfig.json && eslint . --max-warnings 0

Scope: 4 of 5 workspace projects
apps/web typecheck$ next typegen && tsc -p tsconfig.json
packages/audio typecheck$ tsc -p tsconfig.json && tsc -p tsconfig.entry.json
packages/contracts typecheck$ tsc -p tsconfig.json
packages/ui typecheck$ tsc -p tsconfig.json
apps/web typecheck: Generating route types...
apps/web typecheck: ✓ Types generated successfully
packages/ui typecheck: Done
packages/contracts typecheck: Done
apps/web typecheck: Done
packages/audio typecheck: Done

```

`pnpm test`
```
 Test Files  12 passed (12)
      Tests  256 passed (256)
   Duration  3.69s (tests 79%, import 17%, transform 2%, worker 1%)
```

`pnpm perf`
```
> playwright test --project=perf


Running 40 tests using 2 workers

plain   drill_lead_142.flac @44100: loopFrames 149070, maxDiff 3.58e-8, join step 0.109 vs 0.118, min rms 0.0213 vs 0.00791
plain   drill_lead_142.flac @48000: loopFrames 162253, maxDiff 3.58e-8, join step 0.102 vs 0.108, min rms 0.0231 vs 0.00746
  ✓   2 [perf] › e2e/perf/audio-seamless-loop.spec.ts:191:3 › drill_lead_142.flac: two passes on the plain path are the loop twice, with no gap or click (1.1s)
first sound fast, cold: 172 ms
first sound fast, cold: 92 ms
first sound fast, cold: 161 ms
  ✓   1 [perf] › e2e/perf/audio-first-sound.spec.ts:154:1 › first sound on a fast connection, nothing preloaded: under 300 ms (2.5s)
stretch drill_lead_142.flac @44100: diff 0.00 at 0.240 s, joins step 0.0157 vs 0.209; step 0.00552 vs 0.209
first sound throttled, cold: 558 ms
stretch drill_lead_142.flac @48000: diff 0.00 at 0.240 s, joins step 0.00192 vs 0.165; step 0.00227 vs 0.165
  ✓   3 [perf] › e2e/perf/audio-seamless-loop.spec.ts:208:3 › drill_lead_142.flac: two passes through the stretch match an unlooped render, with no gap or click (2.6s)
first sound throttled, cold: 476 ms
live    drill_lead_142.flac @48000: diff 0.00000960 at 1.19 s, changes step 0.00193 vs 0.142, rms 0.0251 vs 0.00530; step 0.000637 vs 0.142, rms 0.00870 vs 0.00530
  ✓   5 [perf] › e2e/perf/audio-seamless-loop.spec.ts:220:3 › drill_lead_142.flac: a live tempo then key change continues from the same place, with no gap or click (905ms)
first sound throttled, cold: 559 ms
  ✓   4 [perf] › e2e/perf/audio-first-sound.spec.ts:166:1 › first sound throttled (CPU 4x, 4G), nothing preloaded: under 800 ms (2.6s)
seek    drill_lead_142.flac @48000: seek step 0.00366 vs 0.209; restart step 0.000143 vs 0.209, fade out 0.930 (before 1.00), fade in 0.0133, from 1.25 s for 1.25 s
  ✓   6 [perf] › e2e/perf/audio-seamless-loop.spec.ts:229:3 › drill_lead_142.flac: a seek while stretched fades out and back in, with no click (732ms)
plain   dusty_soul_90_Dmin.wav @44100: loopFrames 235200, maxDiff 3.58e-8, join step 0.0839 vs 0.109, min rms 0.0254 vs 0.00275
plain   dusty_soul_90_Dmin.wav @48000: loopFrames 256000, maxDiff 3.58e-8, join step 0.0745 vs 0.0936, min rms 0.0306 vs 0.00301
  ✓   8 [perf] › e2e/perf/audio-seamless-loop.spec.ts:191:3 › dusty_soul_90_Dmin.wav: two passes on the plain path are the loop twice, with no gap or click (616ms)
first sound slow, preloaded on hover: 127 ms, requests after click: 0
stretch dusty_soul_90_Dmin.wav @44100: diff 0.00 at 0.240 s, joins step 0.00201 vs 0.187; step 0.00222 vs 0.187
stretch dusty_soul_90_Dmin.wav @48000: diff 0.00 at 0.240 s, joins step 0.0685 vs 0.142; step 0.00200 vs 0.142
  ✓   9 [perf] › e2e/perf/audio-seamless-loop.spec.ts:208:3 › dusty_soul_90_Dmin.wav: two passes through the stretch match an unlooped render, with no gap or click (2.7s)
first sound slow, preloaded on hover: 158 ms, requests after click: 0
live    dusty_soul_90_Dmin.wav @48000: diff 0.0000140 at 1.19 s, changes step 0.000985 vs 0.132, rms 0.00971 vs 0.00526; step 0.00170 vs 0.132, rms 0.0128 vs 0.00526
  ✓  10 [perf] › e2e/perf/audio-seamless-loop.spec.ts:220:3 › dusty_soul_90_Dmin.wav: a live tempo then key change continues from the same place, with no gap or click (981ms)
seek    dusty_soul_90_Dmin.wav @48000: seek step 0.00119 vs 0.150; restart step 0.000493 vs 0.150, fade out 0.966 (before 1.00), fade in 0.00938, from 1.97 s for 1.97 s
  ✓  11 [perf] › e2e/perf/audio-seamless-loop.spec.ts:229:3 › dusty_soul_90_Dmin.wav: a seek while stretched fades out and back in, with no click (937ms)
plain   midnight_keys_140bpm_Am.wav @44100: loopFrames 302400, maxDiff 3.58e-8, join step 0.0112 vs 0.122, min rms 0.0287 vs 0.00878
plain   midnight_keys_140bpm_Am.wav @48000: loopFrames 329142, maxDiff 3.58e-8, join step 0.0111 vs 0.108, min rms 0.0323 vs 0.00940
  ✓  12 [perf] › e2e/perf/audio-seamless-loop.spec.ts:191:3 › midnight_keys_140bpm_Am.wav: two passes on the plain path are the loop twice, with no gap or click (807ms)
first sound slow, preloaded on hover: 296 ms, requests after click: 0
  ✓   7 [perf] › e2e/perf/audio-first-sound.spec.ts:179:1 › first sound on a slow connection after a hover preload: under 800 ms and no request after the click (7.0s)
plain   trap_bells_150_F#m.mp3 @44100: loopFrames 282240, maxDiff 3.58e-8, join step 0.0755 vs 0.143, min rms 0.0213 vs 0.00585
stretch midnight_keys_140bpm_Am.wav @44100: diff 0.00 at 0.240 s, joins step 0.00309 vs 0.221; step 0.00511 vs 0.221
plain   trap_bells_150_F#m.mp3 @48000: loopFrames 307200, maxDiff 3.58e-8, join step 0.0681 vs 0.128, min rms 0.0226 vs 0.00584
  ✓  14 [perf] › e2e/perf/audio-seamless-loop.spec.ts:191:3 › trap_bells_150_F#m.mp3: two passes on the plain path are the loop twice, with no gap or click (988ms)
stretch midnight_keys_140bpm_Am.wav @48000: diff 0.00 at 0.240 s, joins step 0.00423 vs 0.167; step 0.00150 vs 0.167
  ✓  13 [perf] › e2e/perf/audio-seamless-loop.spec.ts:208:3 › midnight_keys_140bpm_Am.wav: two passes through the stretch match an unlooped render, with no gap or click (4.3s)
stretch trap_bells_150_F#m.mp3 @44100: diff 0.00 at 0.240 s, joins step 0.0198 vs 0.170; step 0.00135 vs 0.170
live    midnight_keys_140bpm_Am.wav @48000: diff 0.0000233 at 1.19 s, changes step 0.00129 vs 0.157, rms 0.0136 vs 0.00901; step 0.00164 vs 0.157, rms 0.0172 vs 0.00901
  ✓  16 [perf] › e2e/perf/audio-seamless-loop.spec.ts:220:3 › midnight_keys_140bpm_Am.wav: a live tempo then key change continues from the same place, with no gap or click (901ms)
stretch trap_bells_150_F#m.mp3 @48000: diff 0.00 at 0.240 s, joins step 0.0421 vs 0.172; step 0.00445 vs 0.172
  ✓  15 [perf] › e2e/perf/audio-seamless-loop.spec.ts:208:3 › trap_bells_150_F#m.mp3: two passes through the stretch match an unlooped render, with no gap or click (3.4s)
seek    midnight_keys_140bpm_Am.wav @48000: seek step 0.0217 vs 0.135; restart step 0.000186 vs 0.135, fade out 0.948 (before 1.00), fade in 0.00687, from 2.54 s for 2.54 s
  ✓  17 [perf] › e2e/perf/audio-seamless-loop.spec.ts:229:3 › midnight_keys_140bpm_Am.wav: a seek while stretched fades out and back in, with no click (888ms)
plain   rnb_pad_72bpm_Ebmaj.aiff @44100: loopFrames 294000, maxDiff 3.58e-8, join step 0.0138 vs 0.120, min rms 0.0182 vs 0.00484
plain   rnb_pad_72bpm_Ebmaj.aiff @48000: loopFrames 320000, maxDiff 3.58e-8, join step 0.0121 vs 0.109, min rms 0.0187 vs 0.00406
  ✓  19 [perf] › e2e/perf/audio-seamless-loop.spec.ts:191:3 › rnb_pad_72bpm_Ebmaj.aiff: two passes on the plain path are the loop twice, with no gap or click (631ms)
live    trap_bells_150_F#m.mp3 @48000: diff 0.0000176 at 1.19 s, changes step 0.00467 vs 0.127, rms 0.0189 vs 0.00417; step 0.00234 vs 0.127, rms 0.0278 vs 0.00417
  ✓  18 [perf] › e2e/perf/audio-seamless-loop.spec.ts:220:3 › trap_bells_150_F#m.mp3: a live tempo then key change continues from the same place, with no gap or click (871ms)
seek    trap_bells_150_F#m.mp3 @48000: seek step 0.00564 vs 0.117; restart step 0.000427 vs 0.117, fade out 0.865 (before 1.00), fade in 0.0312, from 2.37 s for 2.37 s
  ✓  21 [perf] › e2e/perf/audio-seamless-loop.spec.ts:229:3 › trap_bells_150_F#m.mp3: a seek while stretched fades out and back in, with no click (727ms)
plain   midnight_keys_reencoded.mp3 @44100: loopFrames 302400, maxDiff 3.58e-8, join step 0.0112 vs 0.118, min rms 0.0272 vs 0.00835
plain   midnight_keys_reencoded.mp3 @48000: loopFrames 329142, maxDiff 3.58e-8, join step 0.0104 vs 0.108, min rms 0.0307 vs 0.00899
  ✓  22 [perf] › e2e/perf/audio-seamless-loop.spec.ts:191:3 › midnight_keys_reencoded.mp3: two passes on the plain path are the loop twice, with no gap or click (413ms)
stretch rnb_pad_72bpm_Ebmaj.aiff @44100: diff 0.00 at 0.240 s, joins step 0.00202 vs 0.166; step 0.00303 vs 0.166
stretch midnight_keys_reencoded.mp3 @44100: diff 0.00 at 0.240 s, joins step 0.00252 vs 0.134; step 0.00529 vs 0.134
stretch rnb_pad_72bpm_Ebmaj.aiff @48000: diff 0.00 at 0.240 s, joins step 0.00447 vs 0.137; step 0.00158 vs 0.137
  ✓  20 [perf] › e2e/perf/audio-seamless-loop.spec.ts:208:3 › rnb_pad_72bpm_Ebmaj.aiff: two passes through the stretch match an unlooped render, with no gap or click (3.4s)
live    rnb_pad_72bpm_Ebmaj.aiff @48000: diff 0.0000167 at 1.19 s, changes step 0.00303 vs 0.131, rms 0.0125 vs 0.00574; step 0.000346 vs 0.131, rms 0.0133 vs 0.00574
stretch midnight_keys_reencoded.mp3 @48000: diff 0.00 at 0.240 s, joins step 0.00393 vs 0.123; step 0.00424 vs 0.123
  ✓  24 [perf] › e2e/perf/audio-seamless-loop.spec.ts:220:3 › rnb_pad_72bpm_Ebmaj.aiff: a live tempo then key change continues from the same place, with no gap or click (867ms)
  ✓  23 [perf] › e2e/perf/audio-seamless-loop.spec.ts:208:3 › midnight_keys_reencoded.mp3: two passes through the stretch match an unlooped render, with no gap or click (3.1s)
live    midnight_keys_reencoded.mp3 @48000: diff 0.0000220 at 1.19 s, changes step 0.00123 vs 0.122, rms 0.0174 vs 0.00263; step 0.00114 vs 0.122, rms 0.0240 vs 0.00263
  ✓  26 [perf] › e2e/perf/audio-seamless-loop.spec.ts:220:3 › midnight_keys_reencoded.mp3: a live tempo then key change continues from the same place, with no gap or click (762ms)
seek    rnb_pad_72bpm_Ebmaj.aiff @48000: seek step 0.000311 vs 0.132; restart step 0.000462 vs 0.132, fade out 0.942 (before 1.00), fade in 0.00853, from 2.47 s for 2.47 s
  ✓  25 [perf] › e2e/perf/audio-seamless-loop.spec.ts:229:3 › rnb_pad_72bpm_Ebmaj.aiff: a seek while stretched fades out and back in, with no click (928ms)
seek    midnight_keys_reencoded.mp3 @48000: seek step 0.0128 vs 0.128; restart step 0.000164 vs 0.128, fade out 0.953 (before 1.00), fade in 0.00844, from 2.54 s for 2.54 s
  ✓  27 [perf] › e2e/perf/audio-seamless-loop.spec.ts:229:3 › midnight_keys_reencoded.mp3: a seek while stretched fades out and back in, with no click (716ms)
plain   midnight_keys_with_tail.wav @44100: loopFrames 302400, maxDiff 3.58e-8, join step 0.0112 vs 0.122, min rms 0.0287 vs 0.00878
plain   midnight_keys_with_tail.wav @48000: loopFrames 329143, maxDiff 3.58e-8, join step 0.0111 vs 0.108, min rms 0.0323 vs 0.00920
  ✓  29 [perf] › e2e/perf/audio-seamless-loop.spec.ts:191:3 › midnight_keys_with_tail.wav: two passes on the plain path are the loop twice, with no gap or click (785ms)
playhead at 1.992x after a change to double tempo
  ✓  28 [perf] › e2e/perf/audio-stretch-minified.spec.ts:163:1 › with the library minified as in the production build, a tempo and key change is heard (2.4s)
stretch midnight_keys_with_tail.wav @44100: diff 0.00 at 0.240 s, joins step 0.00309 vs 0.221; step 0.00511 vs 0.221
stretch midnight_keys_with_tail.wav @48000: diff 0.00 at 0.240 s, joins step 0.00293 vs 0.166; step 0.00210 vs 0.166
  ✓  30 [perf] › e2e/perf/audio-seamless-loop.spec.ts:208:3 › midnight_keys_with_tail.wav: two passes through the stretch match an unlooped render, with no gap or click (3.5s)
live    midnight_keys_with_tail.wav @48000: diff 0.0000233 at 1.19 s, changes step 0.00129 vs 0.157, rms 0.0136 vs 0.00901; step 0.00164 vs 0.157, rms 0.0172 vs 0.00901
  ✓  32 [perf] › e2e/perf/audio-seamless-loop.spec.ts:220:3 › midnight_keys_with_tail.wav: a live tempo then key change continues from the same place, with no gap or click (890ms)
seek    midnight_keys_with_tail.wav @48000: seek step 0.0211 vs 0.113; restart step 0.000197 vs 0.113, fade out 0.948 (before 1.00), fade in 0.00669, from 2.54 s for 2.54 s
  ✓  33 [perf] › e2e/perf/audio-seamless-loop.spec.ts:229:3 › midnight_keys_with_tail.wav: a seek while stretched fades out and back in, with no click (916ms)
loopoff midnight_keys_with_tail.wav plain: end 6.86 s, rms before 0.116, after 0.00, maxDiff 3.58e-8
  ✓  34 [perf] › e2e/perf/audio-seamless-loop.spec.ts:248:3 › midnight_keys_with_tail.wav: with loop off, one pass on the plain path, then silence and paused at 0 (356ms)
fallback after 3003 ms
  ✓  31 [perf] › e2e/perf/audio-stretch-minified.spec.ts:187:1 › a stretch worklet that never says it is ready falls back to the original tempo and key within 3 s (4.6s)
  ✓  36 [perf] › e2e/perf/audio-test-page.spec.ts:47:1 › the audio test page plays a WAV fixture loop (4.8s)
loopoff midnight_keys_with_tail.wav stretch: end 7.00 s, rms before 0.113, after 0.00000274
  ✓  35 [perf] › e2e/perf/audio-seamless-loop.spec.ts:257:3 › midnight_keys_with_tail.wav: with loop off, one pass through the stretch, then silence and paused at 0 (7.5s)
loopoff trap_bells_150_F#m.mp3 plain: end 6.40 s, rms before 0.119, after 0.00, maxDiff 3.58e-8
  ✓  38 [perf] › e2e/perf/audio-seamless-loop.spec.ts:248:3 › trap_bells_150_F#m.mp3: with loop off, one pass on the plain path, then silence and paused at 0 (463ms)
  ✓  37 [perf] › e2e/perf/audio-test-page.spec.ts:146:1 › when the stretch cannot load, the loop plays on at its original tempo with no page error (1.4s)
  ✓  40 [perf] › e2e/perf/budgets.spec.ts:14:3 › / stays inside the page budgets (1.3s)
loopoff trap_bells_150_F#m.mp3 stretch: end 6.54 s, rms before 0.113, after 0.00000237
  ✓  39 [perf] › e2e/perf/audio-seamless-loop.spec.ts:257:3 › trap_bells_150_F#m.mp3: with loop off, one pass through the stretch, then silence and paused at 0 (7.1s)

  40 passed (59.8s)
```
