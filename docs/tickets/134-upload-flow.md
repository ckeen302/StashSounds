# 134 Upload flow for one loop with live processing status
Lane: interface
Depends on: 132, 102

## Goal
A producer drags a loop in, watches it upload and analyze, fixes the detected fields, picks a license and publishes.

## Owned paths
packages/ui/, apps/web/src/app/

## Spec and contracts that apply
- design-spec.md: Upload
- build-spec.md: Routes (/upload)
- architecture.md: The upload pipeline
- contracts: ownItemSchema (checkFields), WORKER_REASON_TEXT

## Acceptance criteria
- [ ] Drop zone fills the content area when empty; each file becomes a card with uploading, analyzing, ready steps
- [ ] Status updates over Supabase Realtime through a Platform-provided subscription helper
- [ ] Detected BPM and key are editable and marked 'check this' when checkFields says so
- [ ] License picker; split percent appears only for split on placement
- [ ] Rights confirmation before publish
- [ ] Refresh does not lose drafts
- [ ] End-to-end test with a fixture loop

## Out of scope
- Multi-file and other types (235)
