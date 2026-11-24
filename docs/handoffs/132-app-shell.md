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

## What changed
Branch `lane/interface-132`: built on `origin/lane/interface-131`, with `origin/lane/audio-121` (98adede) and
`origin/phase-0/foundations` (4c98d92) merged in. The engine is imported only from `@stash/audio`'s entry point
(`getEngine`, `usePlayerState`, types).

- **Root layout** (`apps/web/src/app/layout.tsx`, `_shell/app-shell.tsx`). It mounts the frame outside page content:
  - a skip link;
  - the rail;
  - the top bar;
  - one scrolling content area (`#content`, the only thing that scrolls) holding the toast stack;
  - the player;
  - the phone tab bar.

  `body` is `h-dvh overflow-hidden`.
  - Rail: 232 px on desktop, collapsible to 64 (remembered per browser, read through `useSyncExternalStore`).
    On tablet it is always 64 with icons only, and the labels stay as screen-reader text. Current page:
    `aria-current="page"`.
  - Top bar: 56 px with search centred up to 560 px (a `role="search"` GET form to `/search`), notifications,
    and Sign in. On phone it is 48 px with logo, search icon and notifications.
  - Tab bar (phone, 56 px): Home, Browse, Upload, Library, Profile.
- **Player bar wiring** (`_shell/player-dock.tsx`). It selects `status`, `current?.id`, `durationMs`, `volume` and the
  queue neighbours with `usePlayerState`, and hands `engine.getPositionMs` to the bar. The bar reads it in
  `requestAnimationFrame` (`useFrameLoop`) and writes the elapsed text, the phone progress line and the canvas
  directly. Position never enters React state.
- **Now playing** (`_shell/now-playing.ts`). `Playable` has no title or uploader, so whoever starts playback hands
  over the `ItemRow` it drew. The bar looks it up by `playable.id`.
  - `playFrom(list, i)` makes the list the engine queue, so Previous and Next walk it.
  - `toggle` pauses, resumes or retries the current row.
  - It is kept on `globalThis` like the engine. It is bounded at 200 rows and never evicts the current one.
- **Remembered volume** (`_shell/volume.ts`). Stored in localStorage `stash.volume`, applied with `engine.setVolume`
  on mount and written on every change. Blocked or malformed storage falls back to the engine's 0.8. Mute
  remembers the level to come back to.
- **packages/ui:**
  - `PlayerBar`: desktop 72, tablet 64, phone mini 56 with a progress line. States: idle, loading, playing, paused,
    error. A polite live region announces title, uploader and state. Title and handle are links. BPM and KEY are
    engraved readouts. Previous and Next are disabled without a queue neighbour.
  - `PlayerSheet`: the phone full-screen sheet on Radix Dialog. It slides up (`animate-sheet`, 200 ms, instant
    under reduced motion) and holds a hero waveform with seek, the transport and volume. Escape returns focus to
    the mini player.
  - `PlayerSheetPreview`: the gallery's frozen picture of the sheet.
  - `Slider`: on Radix Slider. States: hover, dragging, focus, disabled.
  - `ToastViewport`: `ToastProvider viewport={false}` lets the shell place the stack.
  - `ButtonLink`, `IconLink`: links drawn as a button and as a ghost icon button.
  - `useFrameLoop`.
  - Icons: House, Compass, Library, User, SkipBack, SkipForward, Volume2, VolumeX, PanelLeftClose and
    PanelLeftOpen, ChevronDown.
  - `Waveform` takes an optional `getProgress` reader. It repaints per frame and keeps the slider's
    `aria-valuenow` and `aria-valuetext` in step, and it resizes the canvas only when its size changes.
- **Result row at 1024 with the 232 px rail** (design advisory). The list is about 744 px wide there, and the title
  had collapsed to 0 px. Now:
  - the title keeps at least 96 px;
  - tags give way first and show only whole chips (a zero-width spacer makes even the first chip wrap into the
    clipped line);
  - the columns are 12 px apart instead of 16.
- **Toasts on phone** (design advisory). They are full width, 12 px from the edges and 12 px above the mini player,
  because the viewport sits inside the content area. On wider screens they sit bottom right, 400 px wide, 24 px in.
- **Placeholder pages** for `/browse/[type]`, `/upload`, `/library`, `/login`, `/notifications` and `/search`
  (`_shell/placeholder.tsx`), plus `not-found.tsx`. See Surprises.
- **`/dev/player`** (not linked, not indexed): the fixture loops through the real engine, plus a "Show a toast"
  button.
- **Gallery:**
  - New `c-slider` and `c-player` sections.
  - Link specimens for Button and Icon button.
  - `e2e/gallery-sections.ts` lists the new sections.
  - Section screenshots grow the window until the section fits, because only the content area scrolls now.

No new dependencies (Radix Slider and Dialog come from `radix-ui`, already recorded in 131). No contract change, no
requests.

Acceptance criteria:
| Criterion | Proof |
| --- | --- |
| Root layout mounts the shell and player bar outside page content | `layout.tsx` wraps `children` in `AppShell`; e2e "the frame has its landmarks..." |
| Desktop rail 232/64, tablet icons, phone bottom tab bar and mini player | e2e "the rail collapses to 64 and remembers it", "on a tablet the rail is icons only...", "the bar is 72 px on desktop and the mini player 56 on a phone", "on a phone the tab bar navigates..."; baselines `shell-rail*`, `shell-tab-bar` |
| Player bar uses usePlayerState selectors and getPositionMs in an animation frame | `player-dock.tsx`; `Elapsed`, `ProgressLine` and `Waveform` read the clock in `useFrameLoop`; e2e checks the elapsed time advances, and holds after pause |
| Playback survives client navigation (end-to-end test) | e2e "playback survives client navigation by the rail": Home, Browse, back twice; a window marker proves no reload; the time keeps advancing; exactly one AudioContext |
| Screenshots at 1440, 1024 and 380 | `home-*`, `shell-*` and `gallery-c-player-*` / `gallery-c-slider-*` in e2e/visual/__screenshots__, all exact (`maxDiffPixels: 0`) |

Design advisories: title truncation at 1024 with the rail (above, plus an e2e check that every title is at least
96 px, the long one ends in an ellipsis, no chip is cut and no row spills); toasts on phone (e2e measures x = 12,
width = 356 and a 12 px gap to the mini player); remembered volume (e2e: 60 percent survives a reload, mute and
unmute).

## Proof
```
$ pnpm check
apps/web typecheck: Generating route types...
apps/web typecheck: ✓ Types generated successfully
packages/contracts typecheck: Done
packages/audio typecheck: Done
packages/ui typecheck: Done
apps/web typecheck: Done
(eslint . --max-warnings 0: no output)

$ pnpm test
Test Files  12 passed (12)
Tests  268 passed (268)

$ pnpm e2e
  ✓   2 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:19:1 › hero waveform seeks with arrows, Shift, Home and End (1.2s)
  ✓   1 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:38:1 › confirm dialog takes focus, keeps it, closes on Escape and returns it (2.0s)
  ✓   4 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:72:1 › overflow menu opens from the keyboard, skips the disabled item, does not wrap (1.5s)
  ✓   3 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:55:1 › form dialog submits on Enter and cannot be closed while it saves (2.9s)
  ✓   5 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:93:1 › tabs move with arrows, Home and End, skipping the disabled tab (1.2s)
  ✓   6 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:110:1 › tooltip opens on keyboard focus with its shortcut (1.4s)
  ✓   7 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:124:1 › a toast with undo appears, announced in the notifications region (1.6s)
  ✓   9 [e2e] › e2e/journeys/gallery.spec.ts:12:1 › every component section is on the gallery, in order (244ms)
  ✓  10 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Button shows every state the design spec lists (280ms)
  ✓   8 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:134:1 › a live row plays, likes and opens its context menu (1.4s)
  ✓  11 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Icon button shows every state the design spec lists (316ms)
  ✓  12 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Play button shows every state the design spec lists (361ms)
  ✓  13 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Text and search input shows every state the design spec lists (351ms)
  ✓  14 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Slider shows every state the design spec lists (364ms)
  ✓  15 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Chip shows every state the design spec lists (348ms)
  ✓  16 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › License badge shows every state the design spec lists (343ms)
  ✓  17 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Avatar shows every state the design spec lists (349ms)
  ✓  18 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Uploader card shows every state the design spec lists (346ms)
  ✓  19 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Stat shows every state the design spec lists (364ms)
  ✓  20 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Tabs shows every state the design spec lists (381ms)
  ✓  21 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Dialog shows every state the design spec lists (504ms)
  ✓  22 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Menu shows every state the design spec lists (448ms)
  ✓  23 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Tooltip shows every state the design spec lists (318ms)
  ✓  24 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Toast shows every state the design spec lists (369ms)
  ✓  25 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Skeleton shows every state the design spec lists (392ms)
  ✓  26 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Empty state and error state shows every state the design spec lists (327ms)
  ✓  27 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Progress steps shows every state the design spec lists (299ms)
  ✓  28 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Result row, loop shows every state the design spec lists (310ms)
  ✓  29 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Waveform shows every state the design spec lists (339ms)
  ✓  30 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Player bar shows every state the design spec lists (369ms)
  ✓  31 [e2e] › e2e/journeys/gallery.spec.ts:26:1 › frozen states carry the attributes that draw them (510ms)
  ✓  33 [e2e] › e2e/journeys/shell.spec.ts:78:1 › next and previous move through the list that started playback (543ms)
  ✓  34 [e2e] › e2e/journeys/shell.spec.ts:88:1 › on a phone the tab bar navigates and the mini player opens the full sheet (757ms)
  ✓  35 [e2e] › e2e/journeys/shell.spec.ts:113:1 › the volume is remembered across visits (463ms)
  ✓  36 [e2e] › e2e/journeys/shell.spec.ts:129:1 › the frame has its landmarks, a skip link, and passes the accessibility scan (650ms)
  ✓  37 [e2e] › e2e/journeys/shell.spec.ts:149:1 › only the content area scrolls (402ms)
  ✓  38 [e2e] › e2e/journeys/shell.spec.ts:160:1 › the rail collapses to 64 and remembers it (364ms)
  ✓  39 [e2e] › e2e/journeys/shell.spec.ts:174:1 › at 1024 with the 232 px rail, long titles truncate and nothing overflows (358ms)
  ✓  40 [e2e] › e2e/journeys/shell.spec.ts:212:1 › on a tablet the rail is icons only and the bar fits without the waveform (334ms)
  ✓  41 [e2e] › e2e/journeys/shell.spec.ts:226:1 › the bar is 72 px on desktop and the mini player 56 on a phone (222ms)
  ✓  42 [e2e] › e2e/journeys/shell.spec.ts:235:1 › on a phone toasts sit full width, 12 px from the edges, above the mini player (707ms)
  ✓  43 [e2e] › e2e/journeys/smoke.spec.ts:13:1 › health route returns the contract shape (26ms)
  ✓  44 [e2e] › e2e/journeys/smoke.spec.ts:19:1 › home renders the wordmark (587ms)
  ✓  32 [e2e] › e2e/journeys/shell.spec.ts:42:1 › playback survives client navigation by the rail (5.8s)
  ✓  46 [e2e] › e2e/journeys/smoke.spec.ts:34:1 › pages refuse to be framed (19ms)
  ✓  45 [e2e] › e2e/journeys/smoke.spec.ts:26:1 › the gallery renders every token and is not indexed (1.8s)
  46 passed (25.9s)

$ pnpm visual
  2 skipped
  85 passed (29.4s)

$ pnpm run licenses
All dependency licenses are on the allowed list.
```

`pnpm visual` ran in the pinned container (mcr.microsoft.com/playwright:v1.63.0-noble). The baselines were
regenerated with `pnpm visual:update` and then passed a separate `pnpm visual` run. The 2 skipped tests are the
collapsed-rail shot at 1024 and 380 (the rail collapses on desktop only). I read the new and changed PNGs: home at
all widths, `shell-*`, `gallery-c-player-*`, `gallery-c-slider-desktop`, `gallery-c-row-*` and
`gallery-c-tabs-*`.

## Not done
- Keyboard map: space, arrows, `[ ]`, `- =`, L, D and `/` (225). The search field shows no `/` hint until then.
- A queue panel, and tempo and key controls in the bar (135; time stretch is 122). The bar shows BPM and KEY as
  readouts.
- A signed-in top bar (avatar) and Profile going to `/u/[handle]` (133 onwards). Profile goes to `/login` for now.
- Swipe down to close the phone sheet (Escape and the close button work). The design spec lists dragging for the
  general Sheet component, which is not built yet.
- Rows do not draw their own playhead from the engine yet. `/dev/player` rows show the play state only; screens
  with lists (231, 135) wire it the same way the bar does.

## Surprises and decisions
- **Placeholder pages.** A link to a route with no page makes the router serve a 404 document as a full page load,
  which stops the player. Its prefetch of that route also never settles, so `networkidle` never came and the
  gallery keyboard journeys timed out. Each route the navigation points at now has a small placeholder ("Browse is
  on the way") that its ticket replaces.
- **`/dev/player` and fixture audio.** The rows use the gallery's fixture loops. In the end-to-end tests their
  `media.stash.local` preview URLs are answered by `page.route` with `fixtures/generated/loops/midnight_keys_140bpm_Am.wav`
  (with CORS), so playback is real Web Audio in Chromium.
- **Display classes.** `className="hidden tablet:inline-flex"` on a component whose base is `inline-flex` can lose:
  both are base utilities and stylesheet order decides. Previous and Next, and Sign in, were showing on phone. They
  are now wrapped in `hidden tablet:contents`. The bar's volume takes its display from the caller.
- **Rail flash.** A collapsed rail is read after hydration, so a reload paints it at 232 for one frame before 64. A
  cookie read on the server would make every page dynamic, so I kept localStorage.
- **Gallery at 1024.** The gallery is narrower than the window (about 744 px), so the `c-player` bar specimens
  scroll sideways from 960 px there. In the shell the bar is full window width, and e2e checks it does not overflow
  at 1024 or at 800.
- **Unit test ids.** Ids like `"p-5"` in `now-playing.test.ts` tripped the spacing lint (it reads strings under
  `apps/web/src/app`). They were renamed `play5`; the rule is unchanged.
- **Smoke test.** "Home renders the wordmark" now scopes to `main`, because the rail and the phone top bar carry
  the wordmark too.

## Requests filed
None.

## Follow-up: /dev/player is not reachable in production
The lead accepted `/dev/player` on the condition that production cannot reach it. The page is now
dynamic and calls `notFound()` unless the server runs with `STASH_DEV_PAGES=1`
(`apps/web/src/app/_shell/dev-pages.ts`, unit-tested). Only the variable decides, not `NODE_ENV`,
because the tests also run a production build. The test servers need the flag, and their config is
lead-owned: docs/requests/132-dev-pages-flag.md. Until that lands, CI's shell journeys answer 404,
which is the intended failure.

```
$ next start (production build, STASH_DEV_PAGES unset)
without flag: /dev/player 404
without flag: /dev/gallery 200

$ STASH_DEV_PAGES=1 pnpm e2e
  46 passed (25.4s)

$ STASH_DEV_PAGES=1 pnpm visual
  85 passed (29.9s)
```
