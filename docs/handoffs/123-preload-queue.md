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
- **Memory budget numbers:** 96 MB of decoded PCM is about 30 eight-second stereo loops at 48 kHz. 32 raw downloads is about a page of results. Both are constructor options, so 132 or 135 can tune them.
- **Merged forward from 122:** the PR #7 fixes affect this ticket in two ways.
  - A loop switch while stretched now waits for the old fade, about 30 ms, before swapping the stretch's buffers. That is added only when the current item is stretched; the plain path is unchanged.
  - The test page now loads `limits.json` through its import map, so a page load makes one extra small request. It is not a fixture request, so it does not affect the "no request after the click" count.

## Requests filed
None.

