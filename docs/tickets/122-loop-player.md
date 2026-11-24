# 122 Loop player with tempo and key shift; the seamless-loop test
Lane: audio
Depends on: 121

## Goal
Loops play seamlessly on their exact sample length with live tempo and key change through Signalsmith Stretch.

## Owned paths
packages/audio/

## Spec and contracts that apply
- build-spec.md: Audio engine interface (loop Playable), Rules (seamless by test, heavy parts load late)
- architecture.md: One engine, four players (Loop)

## Acceptance criteria
- [ ] Loops on loopSamples at sampleRate, not the decoded MP3 length
- [ ] Signalsmith Stretch (MIT) loaded on first use in an AudioWorklet
- [ ] setTempo and setTranspose apply live without restarting
- [ ] The seamless-loop unit test renders two passes of every fixture loop offline and fails on a gap or click at the join
- [ ] If MP3 previews fail that test, file a request to change the preview format

## Out of scope
- Queue (123)
