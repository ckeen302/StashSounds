# Handoff 132 App shell, navigation, the player bar wired to the engine

## Plan (proceeding on the coordinator's go-ahead: stays within the ticket and the Interface paths)
Branch `lane/interface-132` from `origin/lane/interface-131`, with `origin/lane/audio-121` and
`origin/phase-0/foundations` merged in (neither dependency is merged yet).

1. **No contract change.** `Playable` has no title or uploader, so the player cannot name what is
   playing from engine state alone. The app keeps a small "now playing" registry: `playRow(row)`
   records the `ItemRow` (which already carries `playable`) by `playable.id`, then calls
   `engine.play(row.playable)`. The bar selects `current?.id` with `usePlayerState` and looks the row
   up. The engine is imported only from `@stash/audio`'s entry point (`getEngine`, `usePlayerState`).
2. **packages/ui, presentational only (no audio import):**
   - `PlayerBar`: desktop bar (72 px), tablet bar (64 px) and phone mini player (56 px) from one
     component. The states are idle, loading, playing, paused and error. It shows title and handle
     (linked), a mini waveform, previous / play / next, BPM and KEY engraved readouts, elapsed and
     total time, and volume. Props take a `getPositionMs` reader. While playing, one
     requestAnimationFrame loop paints the waveform and writes the time text through refs, so
     position is never React state. A polite live region announces title, uploader and state (design
     spec, Accessibility).
   - `PlayerSheet`: the phone full-screen sheet that opens when the mini player is tapped. It is
     built on Radix Dialog and holds a hero waveform with seek, the transport and volume.
   - `Waveform` gains an optional `getProgress` reader. When it is set, the canvas repaints in an
     animation frame instead of from a prop. The existing `progress` prop keeps working for the
     gallery and the rows.
   - `Slider` (volume), on Radix Slider. States: hover, dragging, focus, disabled.
   - `NavRail` (232 px, collapsible to 64; icons only on tablet), `TabBar` (phone, 56 px: Home,
     Browse, Upload, Library, Profile), `TopBar` (56 px with search centred up to 560 px,
     notifications and sign in; 48 px on phone with logo, search icon and notifications).
   - `ToastViewport` is exported so the shell places it inside the content area. The toast stack
     then sits 12 px from the edges at full width on the phone, directly above the mini player, and
     bottom right above the bar on wider screens.
   - Every new component appears on /dev/gallery in every state, and gallery-sections.ts lists the
     new sections.
3. **apps/web/src/app:**
   - The root layout mounts `AppShell` outside page content: rail, top bar, a single scrolling
     content area, then the player bar and, on phone, the tab bar. Only the content area scrolls.
   - A skip link goes to the content.
   - Active navigation is marked with `aria-current="page"` from `usePathname`.
   - `_shell/now-playing.ts` holds the registry and `playRow`.
   - `_shell/volume.ts` remembers the volume. It reads localStorage on mount and calls
     `engine.setVolume`, and writes on change. Both are wrapped in try/catch, and the default stays
     the engine's 0.8.
   - A dev page, `/dev/player` (not linked, not indexed), lists fixture rows that play through the
     real engine, so the end-to-end test has something to play before the screens land.
4. **Tests first:**
   - Unit (ui): PlayerBar markup per state (labels, aria-busy, live text, disabled transport), Slider,
     NavRail and TabBar `aria-current`, and the `getProgress` repaint helper.
   - Unit (web): the now-playing registry and volume persistence against a fake engine.
   - e2e:
     - Playback survives client navigation. The test routes fixture audio into the preview URLs,
       plays a row, navigates by the rail and by the tab bar, and checks the bar still shows the
       title, the status stays playing, `getPositionMs` keeps advancing and exactly one AudioContext
       exists.
     - Remembered volume across a reload.
     - The shell's landmarks and an axe scan.
     - Title truncation at 1024 with the 232 px rail.
     - Toast placement on the phone: full width, 12 px from the edges, above the mini player.
   - Visual: exact per-region baselines (rail, top bar, player bar in each state, tab bar and mini
     player) at 1440, 1024 and 380, plus the new gallery sections.
5. Lane checks: `pnpm check && pnpm e2e && pnpm visual`, and also `pnpm test` and
   `pnpm run licenses`.

Out of scope: the keyboard map (225), a queue panel, tempo and key controls (135; the engine's
stretch is 122), real profile and notification data (133 and later).
