# 0018 Duplicate lookup, fingerprint threshold and the tempo prior
Tickets 113 and 114, request 114-duplicate-lookup.

## Duplicate lookup
- Context: the worker reads only worker functions (decision 0012). The spec compares a new upload's
  SHA-256 with existing originals and its Chromaprint with stored fingerprints of similar duration,
  and both read other items' rows.
- Options: let the worker query `item_files` and `fingerprints` directly; a service-role function.
- Choice: `public.worker_duplicate_candidates(job, attempt, file, sha256, min_ms, max_ms)`, in
  migration 20261124010000. It checks the job and attempt like every worker function, records the
  SHA-256 on this job's original, and returns exact matches and fingerprints in the duration window.
  It excludes this item and drafts. Execute is revoked from public, anon and authenticated, and
  granted to service_role only. The access audit proves this.
- Reason: the worker's database surface stays the set of worker functions. The hash is recorded at
  lookup time because `worker_complete`'s upsert replaces an original's meta (decision 0016).
  Migration 20261124020000 takes a transaction-scoped advisory lock on the hash. Two lookups of
  the same hash that overlap then run one after the other, so the second finds the first.
- Trust: the parent hashes the staged original before the job child starts, opening it without
  following links. The exact check therefore holds even if the child is taken over. The duration and
  Chromaprint come from the child. A taken-over child can dodge a fingerprint match, but not the
  exact one.
- Consequence: there is no cap on candidates. Phase 1 catalog sizes don't need one. A large catalog
  will need a cap ordered by duration distance, or a coarse index. `flag.detail` (what an item
  matched) is still dropped by `worker_complete`. Storing it waits for the admin queue ticket.

## Fingerprint threshold
- Context: ticket 114 asks for the tuned threshold to be recorded.
- Choice: keep `limits.worker.fingerprintThreshold` at 0.90. Similarity is 1 minus the bit error rate
  at the best alignment that covers at least 90% of the shorter fingerprint. Candidates are within
  0.75x to 1.33x of the upload's duration.
- Reason, measured in handoff 114:
  - Duplicate fixtures score 0.995 to 1.000.
  - Test copies (64 kbps MP3, -6 dB, trimmed at either end) score 0.992 to 1.000.
  - The closest two different loops score 0.781, and 0.749 inside the duration window.
- Consequence: a semitone pitch shift (0.635) and a 5% speed change (0.878) are not caught, as the
  overview expected of Chromaprint. Loops under about 2.6 s have no fingerprint; only the hash applies.
  A flagged item still gets its preview, and an uploader's own re-upload is flagged with the same
  reason.

## Tempo prior and key confidence
- Context: ticket 113's octave fix resolves near-ties toward 70 to 160 BPM. Quarter-note clicks at
  174 BPM now read 87. A lone tonic triad scores key confidence 0.074, under `keyConfidenceMin` (0.15).
- Options: raise the prior's top to about 180; keep 160.
- Choice: keep 70 to 160, and keep the 0.15 key threshold.
- Reason: Stash is hip-hop first, and its tempos sit inside 70 to 160. Eighth-note hats, the common
  case, went from 24 of 40 right to 39 of 40. A click on every beat at 174 can't be told from eighths
  at 87, and a 174 in the file name still wins. A lone C-E-G is genuinely ambiguous between C major,
  A minor and E minor. Marking it "check this" is the honest answer.
- Consequence: drum and bass at 170 to 180 without a tempo in the name is shown at half tempo; the
  uploader corrects it on the check screen. Revisit if that genre grows.
