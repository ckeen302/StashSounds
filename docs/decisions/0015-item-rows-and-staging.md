# 0015 Requests from tickets 102 and 103: staging expiry, row sources, check marks, slugs, cleanup
Date: 2026-11-23. Decided by: lead.

## Staging uploads expire (102-staging-expiry)
Uploads land on `staging/<owner>/<item>/<file>` and completeUpload copies them to the final key
(PR #6 review). The originals bucket on R2 gets docs/deploy/r2-lifecycle.json: objects under
`staging/` are deleted one day after creation and incomplete multipart uploads are aborted after
one day. Locally nothing expires; `pnpm dev` data is disposable.

The remaining race (two concurrent completions plus a third PUT within milliseconds) is closed
when the worker records the SHA-256 of the original it downloaded and publishing compares it:
added to the board for the pipeline lane.

## Where a row's data comes from (103-row-sources)
Accepted as implemented: peaks are read from `meta.peaks` on the peaks file row (typed by
`peaksFileMetaSchema`, decision 0014); a MIDI item's default sound is drums → drums, bass → bass,
chords → keys, melody → pluck; a preset's demoUrl is its worker-made `preview` file, sampled notes
are `sampled_note` files with `meta.pitch`, and MIDI notes are the `notes` file.

## "Check this" marks (103-check-fields)
`limits.bpm.keyConfidenceMin` = 0.15: a chroma key below it is marked. BPM is marked when the
sources disagreed and the source is not exact (filename, MIDI file, uploader). Root note is
marked when it came from pitch tracking. When the owner edits `bpm` or the key, a trigger sets
the source to `uploader` (and `bpmAgreed` true, or `keyConfidence` null), so the mark goes away.
Root-note corrections wait for one-shots (phase 2), since root note lives only in details.

## The slug follows the title (103-slug-on-rename)
A trigger sets `slug = slugify(title)` whenever the title changes. Old addresses still redirect,
because item pages are found by public id.

## File cleanup on delete (103-delete-cleanup)
Accepted in principle, scheduled later: a `cleanup_item` job kind queued by remove_item, which
deletes the item's previews and originals and releases its storage bytes. Until then a removed
item's files stay in storage and its previews' public URLs keep working. On the board.
