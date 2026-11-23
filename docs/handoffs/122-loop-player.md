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

The seamless-loop test (`e2e/perf/audio-seamless-loop.spec.ts`, run by `pnpm perf`). Node has no Web Audio
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

## What changed
- **Dependency:** `signalsmith-stretch` 1.3.2, MIT. It is the time stretch the spec names (architecture.md, Loop). It does live tempo and key change in an AudioWorklet, with its WASM inlined.
- **`src/loop-layout.ts`:**
  - `loopFrames()` gives the loop length in decoded frames. This matters at 48 kHz, where 302400 samples at 44.1 kHz becomes 329142 frames.
  - `paddedLoop()` builds the tail, loop, head layout the stretch needs.
- **`src/engine.ts`:**
  - Loops at the original tempo and key stay on the sample-exact buffer source, now looping on the frame-exact length. The first tempo or key change loads the stretch (`deps.loadStretch`, default `createBrowserStretch`, a dynamic import).
  - A playing loop hands over at `now + latency + 20 ms` from exactly its position, with a 5 ms crossfade. Later changes are scheduled on the running stretch.
  - Position is a timeline of segments on the audio clock.
  - A stretch that fails to load keeps the loop playing at the original tempo and key. State is reset to match, and the load is tried again on the next change.
- **`src/web-audio.ts`:** `StretchNodeLike`, `StretchChange`, `createBrowserStretch()`. `AudioBufferLike` gains `numberOfChannels` and `getChannelData`.
- **`src/signalsmith-stretch.d.ts`:** types for the installed module, which ships none.
- **Test page:** tempo and transpose inputs, an import map, and `/vendor/signalsmith-stretch.mjs` served from `node_modules`.
  - `test-page/seamless.ts` is the offline render harness.
  - `test-page/join-metrics.ts` holds the gap and click measures.
- **Tests:**
  - New `test/engine-stretch.test.ts` (19), `test/loop-layout.test.ts` (6) and `test/join-metrics.test.ts` (6).
  - The fakes gain `FakeBuffer`, `FakeStretch` and `fakeStretchLoader`.
  - The existing engine tests now inject the fake stretch. Their assertions are unchanged.
- **`e2e/perf/audio-seamless-loop.spec.ts`** (new) and **`e2e/perf/audio-test-page.spec.ts`** (extended). Both match the `e2e/perf/audio-*.spec.ts` path the lead assigned to this lane.
- `src/index.ts`, `src/types.ts` and `packages/contracts` are unchanged.

Acceptance criteria:
| Criterion | Proof |
| --- | --- |
| Loops on loopSamples at sampleRate, not the decoded MP3 length | `loop-layout.test.ts` "is loopSamples ... ignoring MP3 padding" and "converts to the context's rate". Seamless plain test: two passes equal the decoded loop twice at 44.1 and 48 kHz, maxDiff 3.6e-8 |
| Signalsmith Stretch (MIT) loaded on first use in an AudioWorklet | "plays on a plain buffer source and never loads the stretch", "loads once, the first time a loop needs it", "engine source never imports the library statically". Browser: no request for the library until the first change, then exactly one |
| setTempo and setTranspose apply live without restarting | "hands a playing loop over to the stretch at the same position, with a crossfade" (one source, not restarted), "applies later changes to the running stretch", "a change before the stretch is heard replaces its pending start". Browser: the playhead runs at 0.4 to 0.6 of real time after halving the tempo, with sound. Offline: after a live tempo then key change, the output matches a render that continues by itself (diff ≤ 2.3e-5) |
| The seamless-loop test renders two passes of every fixture loop offline and fails on a gap or click at the join | `e2e/perf/audio-seamless-loop.spec.ts`: all five fixture loops plus the re-encoded MP3, on both paths, at 44.1 and 48 kHz. It fails when the pads are removed (diff 2.63) and when the handoff position is 50 ms off (diff 8.19); both checked locally |
| If MP3 previews fail that test, file a request | Both MP3s pass (Chromium trims the LAME encoder delay and padding exactly: 302400 decoded frames, lag 0 against the WAV). No request |

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
 Test Files  8 passed (8)
      Tests  187 passed (187)
exit 0
```
(The audio project has 89 tests in 5 files: engine 53, engine-stretch 19, loop-layout 6, join-metrics 6, loader 5. Counted with `--reporter=verbose`.)

`CI=1 pnpm perf --reporter=list` (durations trimmed)
```
> stash@ perf
> playwright test --project=perf --reporter=list
Running 20 tests using 2 workers
  ✓   1 [perf] › e2e/perf/audio-seamless-loop.spec.ts:131:3 › drill_lead_142.flac: two passes on the plain path are the loop twice, with no gap or click
  ✓   2 [perf] › e2e/perf/audio-seamless-loop.spec.ts:131:3 › rnb_pad_72bpm_Ebmaj.aiff: two passes on the plain path are the loop twice, with no gap or click
  ✓   3 [perf] › e2e/perf/audio-seamless-loop.spec.ts:143:3 › drill_lead_142.flac: two passes through the stretch match an unlooped render, with no gap or click
  ✓   5 [perf] › e2e/perf/audio-seamless-loop.spec.ts:155:3 › drill_lead_142.flac: a live tempo then key change continues from the same place, with no gap or click
  ✓   6 [perf] › e2e/perf/audio-seamless-loop.spec.ts:131:3 › dusty_soul_90_Dmin.wav: two passes on the plain path are the loop twice, with no gap or click
  ✓   4 [perf] › e2e/perf/audio-seamless-loop.spec.ts:143:3 › rnb_pad_72bpm_Ebmaj.aiff: two passes through the stretch match an unlooped render, with no gap or click
  ✓   8 [perf] › e2e/perf/audio-seamless-loop.spec.ts:155:3 › rnb_pad_72bpm_Ebmaj.aiff: a live tempo then key change continues from the same place, with no gap or click
  ✓   9 [perf] › e2e/perf/audio-seamless-loop.spec.ts:131:3 › trap_bells_150_F#m.mp3: two passes on the plain path are the loop twice, with no gap or click
  ✓   7 [perf] › e2e/perf/audio-seamless-loop.spec.ts:143:3 › dusty_soul_90_Dmin.wav: two passes through the stretch match an unlooped render, with no gap or click
  ✓  11 [perf] › e2e/perf/audio-seamless-loop.spec.ts:155:3 › dusty_soul_90_Dmin.wav: a live tempo then key change continues from the same place, with no gap or click
  ✓  12 [perf] › e2e/perf/audio-seamless-loop.spec.ts:131:3 › midnight_keys_140bpm_Am.wav: two passes on the plain path are the loop twice, with no gap or click
  ✓  10 [perf] › e2e/perf/audio-seamless-loop.spec.ts:143:3 › trap_bells_150_F#m.mp3: two passes through the stretch match an unlooped render, with no gap or click
  ✓  14 [perf] › e2e/perf/audio-seamless-loop.spec.ts:155:3 › trap_bells_150_F#m.mp3: a live tempo then key change continues from the same place, with no gap or click
  ✓  15 [perf] › e2e/perf/audio-seamless-loop.spec.ts:131:3 › midnight_keys_reencoded.mp3: two passes on the plain path are the loop twice, with no gap or click
  ✓  13 [perf] › e2e/perf/audio-seamless-loop.spec.ts:143:3 › midnight_keys_140bpm_Am.wav: two passes through the stretch match an unlooped render, with no gap or click
  ✓  17 [perf] › e2e/perf/audio-seamless-loop.spec.ts:155:3 › midnight_keys_140bpm_Am.wav: a live tempo then key change continues from the same place, with no gap or click
  ✓  16 [perf] › e2e/perf/audio-seamless-loop.spec.ts:143:3 › midnight_keys_reencoded.mp3: two passes through the stretch match an unlooped render, with no gap or click
  ✓  19 [perf] › e2e/perf/audio-seamless-loop.spec.ts:155:3 › midnight_keys_reencoded.mp3: a live tempo then key change continues from the same place, with no gap or click
  ✓  20 [perf] › e2e/perf/budgets.spec.ts:14:3 › / stays inside the page budgets
  ✓  18 [perf] › e2e/perf/audio-test-page.spec.ts:47:1 › the audio test page plays a WAV fixture loop
  20 passed
exit 0
```
The seamless spec and the test-page spec were also run with `--repeat-each=3`: 57 passed.

Seamless-loop measurements printed by the spec. For the plain path, `maxDiff` is against the decoded loop twice. For stretch and live, `diff` is the largest windowed rms(difference) / rms(reference). Steps are the join's largest sample step against the largest anywhere else.
```
live    drill_lead_142.flac @48000: diff 0.00000960 at 1.19 s, changes step 0.00193 vs 0.137, rms 0.0251 vs 0.0112; step 0.00219 vs 0.137, rms 0.0153 vs 0.0112
live    dusty_soul_90_Dmin.wav @48000: diff 0.0000140 at 1.19 s, changes step 0.000985 vs 0.144, rms 0.00971 vs 0.00526; step 0.00170 vs 0.144, rms 0.0128 vs 0.00526
live    midnight_keys_140bpm_Am.wav @48000: diff 0.0000233 at 1.19 s, changes step 0.00129 vs 0.146, rms 0.0136 vs 0.00901; step 0.00132 vs 0.146, rms 0.0168 vs 0.00901
live    midnight_keys_reencoded.mp3 @48000: diff 0.0000220 at 1.19 s, changes step 0.00123 vs 0.111, rms 0.0174 vs 0.00622; step 0.00188 vs 0.111, rms 0.0221 vs 0.00622
live    rnb_pad_72bpm_Ebmaj.aiff @48000: diff 0.0000167 at 1.19 s, changes step 0.00303 vs 0.128, rms 0.0125 vs 0.00727; step 0.000346 vs 0.128, rms 0.0133 vs 0.00727
live    trap_bells_150_F#m.mp3 @48000: diff 0.0000176 at 1.19 s, changes step 0.00467 vs 0.134, rms 0.0189 vs 0.00711; step 0.00103 vs 0.134, rms 0.0220 vs 0.00711
plain   drill_lead_142.flac @44100: loopFrames 149070, maxDiff 3.58e-8, join step 0.0444 vs 0.203, min rms 0.0191 vs 0.00659
plain   drill_lead_142.flac @48000: loopFrames 162253, maxDiff 3.58e-8, join step 0.0417 vs 0.136, min rms 0.0217 vs 0.00671
plain   dusty_soul_90_Dmin.wav @44100: loopFrames 235200, maxDiff 3.58e-8, join step 0.0976 vs 0.108, min rms 0.0175 vs 0.00377
plain   dusty_soul_90_Dmin.wav @48000: loopFrames 256000, maxDiff 3.58e-8, join step 0.0867 vs 0.0917, min rms 0.0169 vs 0.00378
plain   midnight_keys_140bpm_Am.wav @44100: loopFrames 302400, maxDiff 3.58e-8, join step 0.0112 vs 0.122, min rms 0.0287 vs 0.00758
plain   midnight_keys_140bpm_Am.wav @48000: loopFrames 329142, maxDiff 3.58e-8, join step 0.0111 vs 0.108, min rms 0.0323 vs 0.00796
plain   midnight_keys_reencoded.mp3 @44100: loopFrames 302400, maxDiff 3.58e-8, join step 0.0112 vs 0.118, min rms 0.0272 vs 0.00720
plain   midnight_keys_reencoded.mp3 @48000: loopFrames 329142, maxDiff 3.58e-8, join step 0.0104 vs 0.108, min rms 0.0307 vs 0.00755
plain   rnb_pad_72bpm_Ebmaj.aiff @44100: loopFrames 294000, maxDiff 3.58e-8, join step 0.0848 vs 0.120, min rms 0.0252 vs 0.00560
plain   rnb_pad_72bpm_Ebmaj.aiff @48000: loopFrames 320000, maxDiff 3.58e-8, join step 0.0758 vs 0.109, min rms 0.0295 vs 0.00574
plain   trap_bells_150_F#m.mp3 @44100: loopFrames 282240, maxDiff 3.58e-8, join step 0.0755 vs 0.143, min rms 0.0213 vs 0.00577
plain   trap_bells_150_F#m.mp3 @48000: loopFrames 307200, maxDiff 3.58e-8, join step 0.0681 vs 0.128, min rms 0.0226 vs 0.00540
stretch drill_lead_142.flac @44100: diff 0.00 at 0.240 s, joins step 0.00268 vs 0.188; step 0.00442 vs 0.188
stretch drill_lead_142.flac @48000: diff 0.00 at 0.240 s, joins step 0.00173 vs 0.183; step 0.00407 vs 0.183
stretch dusty_soul_90_Dmin.wav @44100: diff 0.00 at 0.240 s, joins step 0.00160 vs 0.155; step 0.00699 vs 0.155
stretch dusty_soul_90_Dmin.wav @48000: diff 0.00 at 0.240 s, joins step 0.0924 vs 0.144; step 0.000690 vs 0.144
stretch midnight_keys_140bpm_Am.wav @44100: diff 0.00 at 0.240 s, joins step 0.00473 vs 0.217; step 0.00272 vs 0.217
stretch midnight_keys_140bpm_Am.wav @48000: diff 0.00 at 0.240 s, joins step 0.00549 vs 0.171; step 0.00148 vs 0.171
stretch midnight_keys_reencoded.mp3 @44100: diff 0.00 at 0.240 s, joins step 0.00417 vs 0.142; step 0.00344 vs 0.142
stretch midnight_keys_reencoded.mp3 @48000: diff 0.00 at 0.240 s, joins step 0.00455 vs 0.124; step 0.00545 vs 0.124
stretch rnb_pad_72bpm_Ebmaj.aiff @44100: diff 0.00 at 0.240 s, joins step 0.00914 vs 0.178; step 0.00670 vs 0.178
stretch rnb_pad_72bpm_Ebmaj.aiff @48000: diff 0.00 at 0.240 s, joins step 0.00844 vs 0.140; step 0.00454 vs 0.140
stretch trap_bells_150_F#m.mp3 @44100: diff 0.00 at 0.240 s, joins step 0.0252 vs 0.201; step 0.00137 vs 0.201
stretch trap_bells_150_F#m.mp3 @48000: diff 0.00 at 0.240 s, joins step 0.0270 vs 0.163; step 0.00223 vs 0.163
```

`pnpm run licenses`
```
All dependency licenses are on the allowed list.
```

`BASE_REF=origin/phase-0/foundations node scripts/require-tests.mjs`
```
Every changed source file in packages/audio and packages/contracts comes with a test change.
```

## Not done
- Queue and neighbour preload (123). Time to first sound on the test page (123).
- One-shot transpose (221). `setTranspose` on a one-shot still only updates state.
- Safari and Firefox were not tested: Playwright here has Chromium only. The plain-path result depends on the browser trimming MP3 encoder delay (Chromium does). If WebKit does not, its MP3 decode would start with about 1105 samples of silence. Worth a WebKit run when the visual or e2e lane adds one.

## Surprises and decisions
- **The library reads silence at a bare loop point.** Its processor reads a window around the play position and zero-fills anything outside its buffers. With only the loop loaded, the window at every join holds silence: in the probe the output differed from the continuous render by 2.6 (relative). Padding each side with the loop's own audio makes the two renders identical (difference 0).
- **Zero inputs break it silently.** `numberOfInputs: 0` makes the worklet throw on `inputs.length` while inactive, and the node goes silent. The engine keeps the library's default of one input. The browser test caught this.
- **Each new change drops all pending ones.** `schedule()` drops every scheduled change at or after the current time, then fills missing fields from what is left. A partial change sent just after the start could therefore inherit "inactive" and silence the loop. The engine always sends complete changes, and a change made before the stretch is heard replaces the pending start at its own time.
- **A stretch's output depends on its history.** It depends on when the node was created and when each change reached it. The seamless references therefore replay the engine's timing: node, buffers and start at the same render time.
- **Tempo and key carry over between items.** `tempoRatio` and `transpose` still persist from one item to the next, as in the placeholder. So the next loop plays at the same ratio, not the same BPM. Ticket 132 or 135 may want reset or keep-BPM behaviour; that is a product call for the lead.
- **Latency of the stretched path.** Resuming or seeking while stretched waits for the stretch's latency, 0.12 s here, plus 20 ms. At the original tempo and key there is no added latency.
- **The stretch needs a secure context.** AudioWorklet is only available on https or localhost.
- **CSP for the item page.** The worklet module loads from a `blob:` URL, and its WASM is inlined as base64 and compiled in the page. So a CSP on the item page needs both `blob:` and `'wasm-unsafe-eval'` in `script-src`. `connect-src` does not change, because nothing is fetched (Platform/Interface, ticket 135).
- **Third-party notice.** Signalsmith Stretch is MIT (Geraint Luff). Its MIT notice must go into the app's third-party notices when 135 ships it.
- **Bundling.** The library builds its worklet from `Function#toString`. I minified it with the web app's SWC minifier (`compress`, top-level `mangle`) and it still rendered sound in Chromium. The real Next bundle should still be proven once 135 wires a loop page; the existing test-page spec can be pointed at it.
- **The test is not a node unit test.** The ticket says "unit test", but node has no Web Audio decoder for MP3 or FLAC. The test uses Chromium's OfflineAudioContext through the engine's code, under `pnpm perf`. The pieces that can be checked without a browser (layout, metrics, engine scheduling) are node unit tests.
- **AIFF.** The AIFF fixture is converted to WAV inside the spec, because Chromium cannot decode AIFF. The worker's previews are MP3 anyway.

## Requests filed
None.

## Review round (PR #7)

Commits on `lane/audio-122`: d4e6a1e..c838a76, six commits, each with its test. I wrote each test first and saw it fail before the fix.

1. **The entry point typechecks on its own** (d4e6a1e).
   - Before: compiling only `src/index.ts` gave TS7016 at `web-audio.ts`, because the declaration in `signalsmith-stretch.d.ts` was ambient.
   - Fix: `web-audio.ts` now has `/// <reference path="./signalsmith-stretch.d.ts" />`. The new `packages/audio/tsconfig.entry.json` compiles `src/index.ts` alone, as a consumer does, and the package's `typecheck` runs it, so `pnpm check` runs it too.
   - Lint: the reference line carries one `eslint-disable-next-line @typescript-eslint/triple-slash-reference`, with a comment saying why. There is no import form: in a module file, the declaration would be an augmentation of an untyped module, and TypeScript refuses that. Allowing path references in `eslint.config.mjs` instead is the lead's call.
2. **The tempo is clamped to `limits.bpm`, 40 to 300 BPM** (19e099d).
   - The engine imports `@stash/contracts/limits.json` with `{ type: "json" }`. The test page's import map points that specifier at `/vendor/limits.json`, and `serve.mjs` serves the file.
   - Unit tests cover `setTempo(1e6)`: the ratio is 300/140, the stretch is sent that ratio, and the position stays finite and inside the loop 100 s later. They also cover `1e-9` (40 BPM), `Number.MAX_VALUE`, and 0, negative, infinite and NaN values (all ignored).
   - In the browser, the test-page spec now sets `setTempo(1e6)` and checks over 2 s that sound still reaches the output.
3. **A seek or switch while stretched no longer clicks** (37372af).
   - Before: `scheduleStretchStart` cancelled the fade that `stopVoice` had just started and set the gain to 0 at once.
   - Now the fade-out keeps running from where it is, the old position plays under it until T, and the new position ramps in from 0 at T.
   - A switch to another loop also waits until the old fade is silent before it drops the stretch's buffers. Without this, a preloaded item would cut the same way. The wait uses a new `EngineDeps.sleep`, which defaults to a timer.
   - Unit tests: `FakeParam.at(t)` now evaluates the automation as the browser does. The tests check that the gain stays above 0.75 just after the seek or switch, is below 1e-3 at T, and is back to 1 after T. They also check that buffers are dropped only once the fade is silent.
   - Browser check: the seamless spec now renders a seek while stretched for every fixture. It checks:
     - the rms of the 1 ms after the seek over the 1 ms before it (must be above 0.5);
     - the ramp-in at the new start (must be below 0.3);
     - the sample step at both points.
   - I ran this check against the old gain code: it failed for all six fixtures. The step check alone did not catch the cut, because the step from the cut (0.04 to 0.10) is smaller than the loops' own largest steps (0.12 to 0.18). That is why the rms ratio is there.
4. **No leaked node, no stale buffer swap** (465bfc3).
   - If `latency()` rejects, the node is now disconnected before the load is retried.
   - The stretch-chain job now returns early when its buffer is no longer `this.buffer`, both before and after the fade wait.
   - Tests: one disconnect on a failed latency, then a working retry. A queued swap for a replaced loop does not drop or add buffers.
5. **The seamless plain test checks the loop length from the contract** (4239fac).
   - The test now asserts the length from `loopSamples` and `sampleRate`, not through `loopFrames`. It must be within one frame of the exact length.
   - Why "within one frame" and not `Math.round`: at 48 kHz midnight_keys is 329142.86 frames, and Chromium decodes the exact-length WAV to 329142 frames. So `Math.round` (329143) cannot be met, and the engine correctly clamps to the decoded length.
   - New case `midnight_keys_with_tail.wav`: built in the spec by appending 0.75 s of a half-scale 440 Hz sine to the WAV. It runs all four renders. On the plain path it loops at 329143 frames with a max difference of 3.58e-8, so the tail is never played.
6. **The loop survives a stretch that cannot load** (c838a76). A new test-page test routes `/vendor/signalsmith-stretch.mjs` to a 404. After `setTempo(70)`:
   - the tempo falls back to a ratio of 1;
   - the status stays `playing`;
   - the playhead runs at full speed;
   - sound reaches the output;
   - there is no page error.
7. **Handoff notes.** I updated the CSP bullet (`blob:` and `'wasm-unsafe-eval'` in `script-src`, no `connect-src` change) and added the MIT notice bullet, both under Surprises and decisions.

### Lane check after the round

`pnpm check` (exit 0)
```
packages/audio typecheck$ tsc -p tsconfig.json && tsc -p tsconfig.entry.json
packages/ui typecheck: Done
packages/contracts typecheck: Done
apps/web typecheck: Done
packages/audio typecheck: Done
```
`pnpm test` (exit 0)
```
 Test Files  8 passed (8)
      Tests  194 passed (194)
```
`CI=1 pnpm perf` (exit 0)
```
  31 passed (27.4s)
seek    rnb_pad_72bpm_Ebmaj.aiff @48000: seek step 0.00444 vs 0.135; restart step 0.000183 vs 0.135, fade out 0.885, fade in 0.0262, from 2.47 s for 2.47 s
seek    drill_lead_142.flac @48000: seek step 0.00362 vs 0.179; restart step 0.000631 vs 0.179, fade out 0.708, fade in 0.0138, from 1.25 s for 1.25 s
seek    trap_bells_150_F#m.mp3 @48000: seek step 0.00564 vs 0.118; restart step 0.0000410 vs 0.118, fade out 0.718, fade in 0.0240, from 2.37 s for 2.37 s
seek    dusty_soul_90_Dmin.wav @48000: seek step 0.00234 vs 0.123; restart step 0.000100 vs 0.123, fade out 2.08, fade in 0.00697, from 1.97 s for 1.97 s
seek    midnight_keys_reencoded.mp3 @48000: seek step 0.0128 vs 0.117; restart step 0.000246 vs 0.117, fade out 0.924, fade in 0.00652, from 2.54 s for 2.54 s
seek    midnight_keys_140bpm_Am.wav @48000: seek step 0.0217 vs 0.133; restart step 0.000268 vs 0.133, fade out 1.04, fade in 0.00616, from 2.54 s for 2.54 s
seek    midnight_keys_with_tail.wav @48000: seek step 0.0211 vs 0.128; restart step 0.000279 vs 0.128, fade out 1.01, fade in 0.00637, from 2.54 s for 2.54 s
plain   midnight_keys_140bpm_Am.wav @48000: loopFrames 329142, maxDiff 3.58e-8, join step 0.0111 vs 0.108, min rms 0.0323 vs 0.00796
plain   midnight_keys_with_tail.wav @48000: loopFrames 329143, maxDiff 3.58e-8, join step 0.0111 vs 0.108, min rms 0.0323 vs 0.00796
```
`pnpm run licenses`: All dependency licenses are on the allowed list.
`BASE_REF=origin/phase-0/foundations node scripts/require-tests.mjs`: Every changed source file in packages/audio and packages/contracts comes with a test change.
