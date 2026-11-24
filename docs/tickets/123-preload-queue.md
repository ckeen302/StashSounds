# 123 Preload, queue, next and previous; time-to-first-sound test
Lane: audio
Depends on: 122

## Goal
Moving through a list never waits: the next item is fetched and decoded while the current one plays, and first sound is under budget.

## Owned paths
packages/audio/

## Spec and contracts that apply
- build-spec.md: Limits (Performance), Audio engine interface (preload, setQueue, next, previous)
- architecture.md: Performance targets

## Acceptance criteria
- [ ] preload() fetches and decodes; play() of a preloaded item starts without network
- [ ] setQueue/next/previous preload the neighbour
- [ ] `pnpm perf` measures time to first sound on the test page: under 300 ms fast, under 800 ms throttled

## Out of scope
- Keyboard map (225)
