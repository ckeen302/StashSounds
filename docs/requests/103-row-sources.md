# Request 103 Where a row's peaks, MIDI sound and preset demo come from
From lane: platform
For: lead (and Pipeline, which writes the files)
Blocking ticket: none (103 ships with the provisional choices below)

## What I need decided
itemRowSchema needs `peaks` (800 bytes, base64) and `playable` without a second request. The contracts do not say where the server finds three of the inputs:

1. **Peaks.** `item_files` has a `peaks` role, but reading a file from storage for every row of a list adds one request per row.
   - Proposed: the worker writes the base64 peaks into the `meta.peaks` of the `peaks` file row, and still writes the file for share images. This is documented in files.ts, next to "a sampled_note carries { pitch }".
   - Alternative: an `items.peaks` column.
2. **MIDI `sound`.** playable.midi requires a SoundId, and nothing stores one. Proposed: a default from details.kind:
   - drums → drums
   - bass → bass
   - chords → keys
   - melody → pluck
3. **Preset demo.** playable.preset.demoUrl must be a public URL, but the uploader's demo is in the originals bucket.
   - Proposed: the worker's encoded demo is the preset's `preview` file in the previews bucket.
   - Sampled notes are the `sampled_note` files, with `meta.pitch`.
   - MIDI notes are the `notes` file.

## Provisional choice in 103
All three are implemented as proposed. Each sits in one place in apps/web/src/server/items/rows.ts: `peaksFor`, `MIDI_SOUND` and `buildPlayable`.
- An invalid or missing `meta.peaks` gives `peaks: null`.
- A published item with no preview file is logged and dropped from lists.
