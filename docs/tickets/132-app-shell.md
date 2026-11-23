# 132 App shell, navigation, the player bar wired to the engine
Lane: interface
Depends on: 131, 121

## Goal
Every screen sits in the shared frame (rail, top bar, content, player bar) and the player bar shows and controls what the engine is playing across navigation.

## Owned paths
packages/ui/, apps/web/src/app/

## Spec and contracts that apply
- design-spec.md: Layout and grid (frame by width)
- build-spec.md: Behavior every screen shares
- packages/audio public interface

## Acceptance criteria
- [ ] Root layout mounts the shell and player bar outside page content
- [ ] Desktop rail 232/64, tablet icons, phone bottom tab bar and mini player
- [ ] Player bar uses usePlayerState selectors and getPositionMs in an animation frame
- [ ] Playback survives client navigation (end-to-end test)
- [ ] Screenshots at 1440, 1024 and 380

## Out of scope
- Keyboard map (225)
