# 112 Audio decode, loudness-matched preview, peaks, exact loop length
Lane: pipeline
Depends on: 111

## Goal
Every loop upload produces a loudness-matched MP3 preview, 800 waveform peaks and the exact loop length in samples.

## Owned paths
apps/worker/

## Spec and contracts that apply
- build-spec.md: Worker jobs, Loop (decode, duration, preview, peaks), Limits (preview bitrate, loudness, peak points)
- architecture.md: Rules that keep it fast and cheap (content-hashed names)
- contracts: details.loop, worker-result

## Acceptance criteria
- [ ] Real type verified from leading bytes, not the extension; fixtures/generated/hostile/actually_an_exe.wav fails with unsupported_format
- [ ] ffmpeg decode to 44.1 kHz stereo float; silence and files over 60 s rejected (hostile fixtures)
- [ ] Preview at −14 LUFS integrated with −1 dB true peak, MP3 at the bitrate in limits; previews under 500 KB for every fixture loop
- [ ] 800 peak bytes from the mono mix
- [ ] Derived files written to the previews bucket under content-hashed names
- [ ] Every loop fixture in fixtures/manifest.json produces the expected loopSamples and sampleRate

## Out of scope
- BPM and key (113)
- Fingerprints (114)
