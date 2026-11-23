# 113 BPM and key detection with file-name parsing and confidence
Lane: pipeline
Depends on: 112

## Goal
Loops come out of processing with BPM and key filled in, the source of each, and a confidence the upload form uses to say 'check this'.

## Owned paths
apps/worker/

## Spec and contracts that apply
- build-spec.md: Worker jobs, Loop (BPM, Key)
- contracts: detectionSchema, musicalKeySchema, parseKey (mirror it in Python)

## Acceptance criteria
- [ ] BPM: file name 60 to 200, then whole-bar candidates from duration, then librosa onset tempo to choose; bpmAgreed recorded
- [ ] Key: file name parser matching packages/contracts parseKey, else chroma against 24 Krumhansl profiles with margin as confidence
- [ ] Every loop fixture gets its manifest BPM exactly and its manifest key; drill_lead_142.flac gets G minor from chroma
- [ ] Parser tests mirror the contracts key tests case for case

## Out of scope
- One-shot root note (211)
