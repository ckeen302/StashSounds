# Request 112 Name where the waveform peaks live on the worker result
From lane: pipeline
For: lead (packages/contracts)
Blocking ticket: none (Platform's item builder needs it to fill `item.peaks`)

## What I need changed
In `packages/contracts/src/worker.ts`, give the derived file with `role: "peaks"` a typed meta:
```ts
// meta of a role "peaks" file: the same 800 bytes as the stored file, base64, so a row needs no
// second request (common.ts peaksSchema).
export const peaksFileMetaSchema = z.object({ points: z.literal(limits.waveform.peakPoints), peaks: peaksSchema });
```
Then refine `workerResultSchema` so that a `peaks` file's meta must match it. The worker already
writes exactly this shape (`{points: 800, peaks: "<base64>"}`), and `worker_complete` copies it into
the `item_files.meta` of the peaks row.

## Why
`item.peaks` (item.ts) is base64 peaks, but nothing says where it comes from. Without a named key,
Platform would have to guess it, or download the `.peaks` object for every card. The preview's
meta (`bitrateKbps`, `sampleRate`, `loudnessLufs`) could be named the same way.

## Workaround in the meantime
The worker writes `meta.points` and `meta.peaks` on the peaks file. The runner's real-database test
reads the peaks row's meta back.
