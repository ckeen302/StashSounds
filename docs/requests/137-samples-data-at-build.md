# Request 137 Build the Samples tab's indexes at build time, and start its chunk with the shell
From lane: interface
For: lead (scripts/build-demo-app.mjs) and the shell thread (apps/web/src/demo/main.tsx)
Blocking ticket: none

## What I need changed
1. In `scripts/build-demo-app.mjs`, add an esbuild plugin that loads
   `apps/web/src/demo/samples/samples.json` and `samples/covers.json` as
   `export default JSON.parse(<string literal>)` rather than as a JS object literal. For large
   data, V8 parses JSON text about 3x faster than an object literal: in Node, 22 ms against 64 ms
   for these two files.
2. Optionally, have the build script precompute `SAMPLE_SONGS`, `ORIGINALS`, `ARTISTS` and
   `PRODUCERS` (all of `samples/data.ts`'s module-level work) into one JSON file, so the
   device only reads the indexes and never builds them.
3. In `main.tsx`, when the first address is `#/samples…`, `#/sampled/…`, `#/samples-artist/…`
   or `#/samples-producer/…`, call `samplesPage()` at module load. The 3.4 MB chunk then
   downloads while the app boots, not after the first render. On a real phone network,
   most of the cold-open time is that download.

## Why
On a phone (4x CPU), switching to Samples from another tab already takes about 0.4 s, the same
as Browse. A cold open of `#/samples` takes about 3.9 s, against 2.2 s for Browse. The profile
puts the difference in evaluating the samples chunk: the JSON literals, then building the
indexes, about 200 ms unthrottled and about 0.8 s at 4x. A further cost comes from the chunk
starting to load only after the shell has rendered. The Sampler restyle did not change this.
The same build before the restyle measured 3.7 to 3.9 s.

## Workaround in the meantime
`samples/data.ts` now folds each name and builds each record key once (memoised `flat` and
`originalKey`), which cuts that chunk's evaluation from about 240 ms to 200 ms unthrottled.
