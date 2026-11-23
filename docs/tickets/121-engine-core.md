# 121 Engine core: context lifecycle, load, play, pause, seek, state, subscribe
Lane: audio
Depends on: 003

## Goal
The real engine replaces the state-only placeholder behind the same interface: one audio context per session, loading and decoding, play, pause, seek and state updates.

## Owned paths
packages/audio/

## Spec and contracts that apply
- build-spec.md: Audio engine interface and Rules behind the interface
- architecture.md: Real-time playback, Performance targets

## Acceptance criteria
- [ ] The public surface in packages/audio/src/index.ts does not change
- [ ] unlock() creates the AudioContext on the first gesture; it is never recreated on navigation
- [ ] Failures set status 'error' with retry and never throw into the UI
- [ ] getPositionMs() reads the audio clock; position is never React state
- [ ] Unit tests with an offline or mocked AudioContext for every method
- [ ] A bare test page (packages/audio/test-page) that plays a fixture loop

## Out of scope
- Stretch (122)
- UI beyond the bare test page
