# 131 Core components with all states, shown in the gallery
Lane: interface
Depends on: 005

## Goal
The first components exist in packages/ui and appear in /dev/gallery in every state, so screens can be composed from them.

## Owned paths
packages/ui/, apps/web/src/app/

## Spec and contracts that apply
- design-spec.md: Components, Rules for building them, Motion, Accessibility
- playbook.md: The design loop (gallery, rubric, ban list)
- docs/design/refs/ (see decision 0006)

## Acceptance criteria
- [ ] Button, Icon button, Play button, Text and search input, Chip, License badge, Avatar, Uploader card, Stat, Tabs, Dialog, Menu, Tooltip, Toast, Skeleton, Empty state, Error state, Progress steps, Result row (loop variant), Waveform (mini and hero)
- [ ] Accessible primitives from a headless library (record its license)
- [ ] Each in every state listed in the design spec, on /dev/gallery
- [ ] Visual baselines for the gallery at 1440, 1024 and 380
- [ ] Design reviewer scores 4 or higher on every criterion

## Out of scope
- Pad grid, piano roll, keyboard (phase 2)
