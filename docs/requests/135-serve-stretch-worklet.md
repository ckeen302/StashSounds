# Request 135 Serve the time stretch's worklet file from the web app
From lane: audio
For: lead (scripts/, apps/web/next.config.ts, apps/web/package.json); interface if it lands in apps/web/public
Blocking ticket: 135 (answers 135-stretch-in-production-build)

## What I need changed
The engine now loads the stretch's AudioWorklet from a static file instead of letting the library
stringify its own (bundled, minified) functions. The web app must serve that file. Without it, the
first tempo or key change waits 3 s, then the loop plays on at the original tempo and key (state goes
back to tempo 1, key 0). It no longer hangs, but the stretch is never heard.

Copy one file at build time, and on `dev` too:

| | |
| --- | --- |
| From | `stretchWorkletFile` exported by `@stash/audio/stretch-worklet-file` (today `node_modules/.pnpm/signalsmith-stretch@1.3.2/node_modules/signalsmith-stretch/SignalsmithStretch.mjs`, the installed library unminified) |
| To | `apps/web/public` + `STRETCH_WORKLET_PATH` from the same module, today `apps/web/public/worklets/signalsmith-stretch-1.3.2.mjs` |
| Served at | `/worklets/signalsmith-stretch-1.3.2.mjs`, same origin as the page |

A copy script, for example `scripts/copy-stretch-worklet.mjs`, run before `next build` and `next dev`:
```js
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STRETCH_WORKLET_PATH, stretchWorkletFile } from "@stash/audio/stretch-worklet-file";

const to = join(import.meta.dirname, "../apps/web/public", STRETCH_WORKLET_PATH);
await mkdir(dirname(to), { recursive: true });
await copyFile(stretchWorkletFile, to);
```
The module is plain Node ESM (`.mjs`, with a `.d.mts`) so a script can import it without a TypeScript
step. It resolves from apps/web, which depends on `@stash/audio`. From scripts/ at the repo root it
does not resolve yet, because the root has no `@stash/audio` dependency. Either add one, or run the
copy from apps/web (for example `"prebuild"`/`"predev"` in apps/web/package.json running
`node ../../scripts/copy-stretch-worklet.mjs`, with the import resolved from apps/web).

Details:
- Do not commit the copied file. `apps/web/public/worklets/` goes in .gitignore. The file is the
  installed library, and a committed copy would drift from the lockfile.
- The version is in the path, so the file can be cached for a long time (`Cache-Control: public,
  max-age=31536000, immutable` on `/worklets/:path*` in next.config.ts headers). Optional.
- Next serves `.mjs` from public/ as `application/javascript`, which `audioWorklet.addModule` accepts.
  No CSP is set today. If one is added, `script-src 'self'` covers this file, and the Blob URL is
  no longer needed.
- When signalsmith-stretch is bumped, `STRETCH_VERSION` in packages/audio/src/web-audio.ts changes
  with it: `packages/audio/test/stretch-worklet.test.ts` fails until it does.

Proof once it lands: the e2e journey `e2e/journeys/loop-page.spec.ts` "at double tempo the loop really
plays twice as fast" (on lane/interface-135, marked `test.fail()`) should pass. Remove the marker in
the same change. Inside the Audio lane, `e2e/perf/audio-stretch-minified.spec.ts` covers the engine
with the library bundled as Turbopack does it.

## Why
Read from a `next build` chunk: the Emscripten factory inside signalsmith-stretch reads the free
variable `process`, which Turbopack replaces with its polyfill imported at module scope
(`var g = A.i(17559)` ... `typeof g.default`). The library then stringifies that factory into the
worklet, where `g` does not exist: "g is not defined". With `moduleUrl` set, the worklet runs the
unminified file, and only the main-thread half runs from the bundle.

## Workaround in the meantime
None that makes the stretch heard. Until the file is served, the engine falls back after 3 s.
