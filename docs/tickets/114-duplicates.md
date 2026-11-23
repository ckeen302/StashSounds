# 114 SHA and Chromaprint duplicate check, flagged status with reason
Lane: pipeline
Depends on: 112

## Goal
Re-uploads of something already on Stash are caught: exact copies by SHA-256 and trimmed or re-encoded copies by Chromaprint.

## Owned paths
apps/worker/

## Spec and contracts that apply
- build-spec.md: Worker jobs (common step 2, Fingerprint)
- overview.md: Screening uploads
- data-model.md: fingerprints, item_files_sha_idx
- contracts: workerReasonSchema, WORKER_REASON_TEXT

## Acceptance criteria
- [ ] SHA-256 of the original; an exact match on another user's original flags duplicate_exact
- [ ] fpcalc fingerprint stored per original; similarity over limits.worker.fingerprintThreshold against originals of similar duration flags duplicate_fingerprint
- [ ] fixtures/generated/duplicates: the copy, the trimmed copy and the re-encoded copy are each flagged after the original is processed
- [ ] The same user re-uploading their own file is flagged too (it is still a duplicate) but the reason text invites review
- [ ] Threshold tuned on fixtures and recorded in a decision file

## Out of scope
- Commercial fingerprinting (311)
