# Request 112 A byte cap for loop previews in limits.json
From lane: pipeline
For: lead (packages/contracts/limits.json, and scripts/sync-limits.mjs if the database needs it)
Blocking ticket: none (the worker derives the cap until this lands)

## What I need changed
Add `limits.preview.loopMaxBytes: 1024000` (1000 KiB). The worker would read it in
`files.loop_preview_max_bytes()` instead of deriving it.

## Why
PR #8 security finding B2: the parent must cap what it publishes to the public previews bucket, so a
compromised job cannot fill it with large immutable files. Today the worker derives the cap:
- The longest loop is 60 s, at 128 kbps, giving 960,000 bytes.
- The short regime is 20 s at 192 kbps, giving 480,000 bytes.
- The larger of the two, plus 5% and 16 KiB for frame padding and the ID3 and Xing headers, is
  1,024,384 bytes.

A named value keeps that decision in limits, next to the bitrates it depends on.

## Workaround in the meantime
`loop_preview_max_bytes()` derives the cap from `loop.maxDurationMs` and the two preview bitrates.
`test_the_preview_cap_follows_the_longest_loop_at_its_bitrate` pins it.
