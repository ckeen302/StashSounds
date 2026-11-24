# 190 End-to-end test: every loop fixture uploaded, processed, published, played and downloaded through the real path
Lane: lead
Depends on: all phase 1 tickets

## Goal
Phase 1 is done: loops work end to end through the real stack, and duplicates are caught.

## Owned paths
everything the lead owns (CLAUDE.md)

## Spec and contracts that apply
- overview.md: Build phases (Phase 1 gate)
- fixtures/manifest.json

## Acceptance criteria
- [ ] Every loop fixture goes through upload, processing, publish, play and download in `pnpm e2e` against `pnpm dev`
- [ ] The duplicate fixtures are flagged
- [ ] Each loop plays within 300 ms on its page
- [ ] The owner uploads 20 of their own loops and confirms the same

## Out of scope
- Phase 2
