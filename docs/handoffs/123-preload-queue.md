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
