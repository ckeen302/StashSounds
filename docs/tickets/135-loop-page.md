# 135 Loop item page with waveform, tempo and key controls, download
Lane: interface
Depends on: 132, 103, 122

## Goal
A visitor from Google lands on a loop page, presses space and hears it under budget, changes tempo and key, and downloads with a license record.

## Owned paths
packages/ui/, apps/web/src/app/

## Spec and contracts that apply
- design-spec.md: Item page, Waveform
- build-spec.md: Routes (/[type]/[slug]-[id]), Limits (Performance)

## Acceptance criteria
- [ ] Server-rendered with correct metadata and preview card
- [ ] Hero waveform drawn from peaks before audio arrives
- [ ] Tempo, key, loop and volume controls bound to the engine
- [ ] Download calls requestDownload and shows the license
- [ ] End-to-end and perf tests: first sound under 300 ms, LCP under 2.0 s, CLS under 0.05

## Out of scope
- Similar items section (204)
