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
