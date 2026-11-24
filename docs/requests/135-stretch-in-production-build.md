# Request 135 Time stretch never loads in the built web app
From lane: interface
For: audio (packages/audio), lead (apps/web/next.config.ts if the fix lands there)
Blocking ticket: 135 (tempo and key must change the sound live on the loop page)

## What I need changed
In `next build` output, the first tempo or key change never reaches the stretch:
`createBrowserStretch()` never resolves, so the loop keeps playing at the original tempo and key
while engine state says `tempoRatio: 2` (the page's readouts, which read engine state, then show a
change nobody hears).

Cause, traced in Chromium against the production build (`next start`, ticket 135 loop page):
- `signalsmith-stretch` builds its worklet by stringifying its own functions
  (`` `(${registerWorkletProcessor})((_scriptName=>${Module})(), …)` `` → Blob URL → `addModule`).
- The bundler minifies those functions. The stringified processor refers to a minified name from
  the enclosing scope that does not exist inside the worklet.
- `addModule` resolves, the `AudioWorkletNode` is made, then the processor fails:
  `processorerror: Uncaught ReferenceError: g is not defined`. The library waits forever for the
  worklet's `ready` message, so `loadStretch` hangs (it does not reject, so the fallback in
  `prepareStretch` never runs).

The audio test page (`packages/audio/test-page`) serves the library unminified through an import
map, which is why `pnpm perf` passes.

Proposed fixes, Audio lane's choice:
1. Give the worklet an unminified module URL. The library supports it: `SignalsmithStretch.moduleUrl`
   (read as `createNode.moduleUrl` before it falls back to stringifying). Serve the installed
   `SignalsmithStretch.mjs` as a static file (copied at build time, versioned path) and set
   `moduleUrl` in `createBrowserStretch` before the first call.
2. Or keep the library out of minification for the web build (lead: next.config.ts).
3. Either way, a timeout on `loadStretch` and on `node.latency()` (for example 3 s), so a worklet that
   never answers falls back like a failed load and state goes back to tempo 1 and key 0.
4. A perf test against the built app, not only the test page: the loop page at
   `/loop/dusty-soul-chops-k3j9x0a2b1` with STASH_DEV_PAGES=1 plays a fixture with no database.

## Why
Ticket 135's goal: "changes tempo and key, and downloads". Without this, tempo and key are bound to
the engine (state, readouts and keys all work) but the sound does not change.

## Workaround in the meantime
None in the Interface lane: the fix is inside the engine or the build. The e2e journey
`e2e/journeys/loop-page.spec.ts` has one test, "at double tempo the loop really plays twice as
fast", marked `test.fail()` with this request's name. It asserts the broken state today and turns
red the moment the stretch works, so the marker is removed in the same change as the fix.
