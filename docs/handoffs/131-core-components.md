# Handoff 131 Core components with all states, shown in the gallery

## Plan (pre-approved by the lead: stays within the ticket and the Interface paths)
1. Dependencies in packages/ui: `radix-ui` (headless primitives for dialog, menu, context menu,
   tooltip, tabs, toast, avatar) and `lucide-react` (one outline icon set, drawn at 16 and 20 px with
   a 1.5 px stroke). Read the installed types before use. Keep `pnpm run licenses` green.
2. packages/ui/src/components.css: the few things a class cannot say without an arbitrary value
   (keyframes for the loading ring and overlay enter/leave, the `--progress` and `--playhead` readers,
   preview variants for the gallery). Only `var(--color-*)` and the motion token durations; a unit test
   holds it to that. Tailwind scans packages/ui through an `@source` line in the same file.
3. Components in packages/ui/src/components, one file each, props only, no data access, no audio:
   Button, IconButton, PlayButton, TextInput and SearchInput, Chip, LicenseBadge, Avatar,
   UploaderCard, Stat, Tabs, Dialog, Menu (overflow and context), Tooltip, Toast, Skeleton,
   EmptyState, ErrorState, ProgressSteps, ResultRow (loop variant, with header and skeleton),
   Waveform (mini and hero, canvas, peaks from contracts' peaksSchema as a prop).
   Shared shapes (ItemRow, ItemType, LicenseKind, LICENSES, formatKey, decodePeaks) come from
   @stash/contracts.
4. Gallery states: every component accepts `data-hover`, `data-focus` and `data-active` attributes
   that draw the same styles as the real pointer and keyboard states, so /dev/gallery shows hover,
   focus and pressed side by side without interaction. Overlays (dialog, menu, tooltip, toast) show
   a frozen, `inert` picture of the open state built from the same surface components, next to a
   live trigger that opens the real Radix primitive.
5. Unit tests (packages/ui/test): waveform bar maths, components.css token guard, server-rendered
   markup for the accessibility contract of each component (labels, aria-busy, aria-invalid,
   aria-pressed, roles).
6. Visual baselines for /dev/gallery at 1440, 1024 and 380 from the pinned container; read every
   PNG and fix what looks wrong; then `pnpm check && pnpm e2e && pnpm visual` and `pnpm test`.

## What changed
Branch `lane/interface-131`, from `phase-0/foundations` (fa3fc9f).

- **packages/ui/src/components/**: the twenty ticket components, one file each, props only (no data
  queries, no audio code): `Button`, `IconButton`, `PlayButton`, `TextInput` and `SearchInput`,
  `TypeChip` / `TagChip` / `FilterChip`, `LicenseBadge`, `Avatar`, `UploaderCard`, `Stat`,
  `Tabs` / `TabList` / `Tab` / `TabPanel`, `Dialog`, `Menu` and `ContextMenu`, `Tooltip`, `Toast`
  (`ToastProvider` + `useToast`), `SkeletonBlock` / `SkeletonText` / `SkeletonCard`, `EmptyState`,
  `ErrorState`, `ProgressSteps`, `ResultRow` (loop variant, with `ResultHeader`, `ResultList`,
  `ResultRowSkeleton`, `ResultListSkeleton`) and `Waveform` (mini and hero). Small helpers: `Icon`
  plus the re-exported icon set, `Kbd`, `Spinner`, `LinkProvider` / `UiLink`.
  - Shapes come from @stash/contracts: `ResultRow` takes an `ItemRow`; `Waveform` takes `peaks` as
    the base64 string `peaksSchema` validates (`Peaks = NonNullable<ItemRow["peaks"]>`) and decodes it
    with `decodePeaks`; `LicenseBadge` reads `LICENSES`; keys print with `formatKey`.
  - Waveform: canvas at device pixel ratio, ResizeObserver for size, bar values from the 800 peaks by
    slice maximum, 2 px floor, mirrored rounded bars (2+1 mini, 3+1 hero), 35 percent before the
    playhead, hero accent playhead with its time, ghost line with time on hover or scrub, bar ticks
    from `bars`, uniform low bars while peaks are null, error state. Bar values are memoised per size
    and peaks; only the paint repeats as the position moves. A scrubbable hero is a `role="slider"`
    with arrow, Home and End keys; a mini is `role="img"` with a text description.
  - `LinkProvider` lets the app hand in `next/link`, so row titles, uploader links and license links
    navigate on the client and the player (ticket 132) keeps playing.
- **packages/ui/src/components.css** (exported as `@stash/ui/components.css`): `@source` for
  Tailwind, the `ui-hover` and `ui-active` variants (real state or `data-hover` / `data-active`, never
  on disabled), the `[data-focus]` ring, `w-progress` / `left-playhead` / `left-pointer` readers for
  `style={{ "--progress": x }}`, and keyframes for the loading ring, overlay enter and leave (4 px
  rise, 160 ms) and the like pulse (200 ms). `css-vars.ts` types the three CSS variables for React.
- **packages/ui/test/**: `waveform-bars.test.ts` (layout, slice maximum, floor, base64 round trip,
  time), `components-css.test.ts` (no raw colors, colors only via theme variables, durations only
  from motion tokens, ring stops under reduced motion), `components.test.ts` (server-rendered markup
  for each component's accessibility contract).
- **apps/web/src/app/**: `providers.tsx` (link, tooltip and toast providers, mounted in
  `layout.tsx`), `globals.css` imports components.css, and `/dev/gallery` renders every component in
  every state after the token sections (`component-gallery.tsx`). Gallery content is the five loops
  in fixtures/generated/loops with their real peaks (`fixture-peaks.ts`: ffmpeg decode, maximum of
  |sample| over 800 slices of the mono mix) and real tempos, keys and lengths, parsed with
  `itemRowSchema` (`gallery-data.ts`).
- **e2e/visual/__screenshots__/gallery-visual-{desktop,laptop,phone}.png**: new baselines from the
  pinned container (`pnpm visual:update`). Home baselines are unchanged.

### Dependencies (rule 8)
| Package | Version | License | Why |
| --- | --- | --- | --- |
| `radix-ui` | 1.8.1 (published 2026-10-12) | MIT | Headless, accessible primitives for dialog, dropdown and context menu, tooltip, tabs, toast and avatar: focus trap, roving focus, Escape and focus return come from the library; style comes only from tokens. |
| `lucide-react` | 1.70.0 (published 2026-11-06) | ISC | One outline icon set, drawn at 16 and 20 px with a fixed 1.5 px stroke (`absoluteStrokeWidth`). |
| `react-dom`, `@types/react-dom` (dev, packages/ui) | 19.3.1, 19.3.0 | MIT | Already in apps/web; packages/ui's tests render markup with `react-dom/server`. |

Types read before use: `@radix-ui/react-dialog` 1.3.1, `react-dropdown-menu` 2.2.1, `react-menu`,
`react-tooltip` 1.4.1, `react-tabs` 1.2.1, `react-toast` 1.3.1, `react-avatar`, `react-popper`
(side, sideOffset), and `lucide-react`'s `LucideProps`. `pnpm run licenses` passes.

## Proof
`pnpm check && pnpm e2e && pnpm visual` (the Interface lane check), exit 0:
```
> stash@ check
> pnpm -r --parallel typecheck && tsc -p tsconfig.json && eslint . --max-warnings 0

Scope: 4 of 5 workspace projects
apps/web typecheck$ next typegen && tsc -p tsconfig.json
packages/audio typecheck$ tsc -p tsconfig.json
packages/contracts typecheck$ tsc -p tsconfig.json
packages/ui typecheck$ tsc -p tsconfig.json
apps/web typecheck: Generating route types...
apps/web typecheck: ✓ Types generated successfully
packages/audio typecheck: Done
packages/contracts typecheck: Done
packages/ui typecheck: Done
apps/web typecheck: Done

Running 4 tests using 2 workers

  ✓  2 [e2e] › e2e/journeys/smoke.spec.ts:13:1 › health route returns the contract shape (44ms)
  ✓  1 [e2e] › e2e/journeys/smoke.spec.ts:19:1 › home renders the wordmark (623ms)
  ✓  4 [e2e] › e2e/journeys/smoke.spec.ts:33:1 › pages refuse to be framed (22ms)
  ✓  3 [e2e] › e2e/journeys/smoke.spec.ts:25:1 › the gallery renders every token and is not indexed (1.7s)

  4 passed (8.4s)

> stash@ visual
> node scripts/visual.mjs

Running 6 tests using 2 workers

  ✓  2 [visual-desktop] › e2e/visual/screens.spec.ts:11:3 › home matches its baseline (404ms)
  ✓  3 [visual-laptop] › e2e/visual/screens.spec.ts:11:3 › home matches its baseline (331ms)
  ✓  1 [visual-desktop] › e2e/visual/screens.spec.ts:11:3 › gallery matches its baseline (1.6s)
  ✓  5 [visual-phone] › e2e/visual/screens.spec.ts:11:3 › home matches its baseline (263ms)
  ✓  4 [visual-laptop] › e2e/visual/screens.spec.ts:11:3 › gallery matches its baseline (1.3s)
  ✓  6 [visual-phone] › e2e/visual/screens.spec.ts:11:3 › gallery matches its baseline (1.0s)

  6 passed (4.0s)
```
The gallery test in e2e runs the axe scan (wcag2a, wcag2aa) over the whole gallery, every component
included: no serious or critical findings.

`pnpm test`, exit 0 (88 of these are new, in packages/ui/test):
```
 Test Files  7 passed (7)
      Tests  145 passed (145)
```

`pnpm run licenses`, exit 0:
```
All dependency licenses are on the allowed list.
```

Screenshots: e2e/visual/__screenshots__/gallery-visual-desktop.png (1440), -laptop.png (1024),
-phone.png (380). I read every section at all three widths and fixed what looked wrong: ghost and
pad pressed states that did not show on a surface panel, the selected row's accent bar losing to a
transparent default, tag chips vanishing on the raised (hover and playing) rows, BPM and BARS
reading as one number, invisible bar ticks, the hero error text crossing the flat line, and danger
pressed falling to 4.41 to 1 (caught by axe).

Live behaviour, checked with a throwaway Playwright script against the built gallery (not committed:
e2e/journeys is outside my paths): the confirm dialog opens, passes axe, closes on Escape and returns
focus to its trigger; the form dialog submits on Enter, shows loading, then closes; the overflow menu
opens from the keyboard, arrows skip the disabled item, Escape returns focus; the tooltip opens on
keyboard focus with its shortcut; a toast with Undo appears bottom right; tabs move with the arrow
keys; a live row plays, likes, and opens the context menu on right-click; the hero waveform's slider
moves from 42 to 47 on ArrowRight.

## Not done
- The other ten components in the design spec's table (select, slider, stepper, drop zone, piano
  roll, pad grid, keyboard, transport, player bar, sheet) are outside this ticket.
- Result row variants for one-shot, kit, MIDI and preset: the ticket asks for the loop variant. The
  length column already formats bars, samples and seconds from `ItemRow.length`; the header says
  BARS, and the mixed-type header (LEN) comes with those variants.
- The accent bar sliding between rows when selection moves (120 ms) needs a list that owns the
  selection; ResultRow takes `selected` and transitions the bar's color. The list belongs to browse.
- Keyboard and interaction e2e tests for dialog, menu, tooltip, tabs and toast: e2e/journeys is not
  in my paths. Suggest the lead (or ticket 136) turns the checks under Proof into a journey.
- Phone long-press sheet for row actions: on phone the action column is hidden and the row is a
  Radix context menu trigger, which opens on long-press; the bottom sheet is the Sheet component.
- The design reviewer has not run; whether every criterion scores 4 or more is for that review.

## Surprises and decisions
- **No reference frames (decision 0006).** Built from design-spec.md alone, as the owner asked.
  Places where a frame would have settled the choice:
  1. Avatar shape: circles. A square, pad-shaped avatar would carry the pad motif further.
  2. Liked heart: filled in `text` (white), not accent, because accent means live; the spec says
     only "the icon fills".
  3. Selected tab underline: `text`, 2 px, not accent (same reason).
  4. Hover and playing rows both use `raised`; the playing row is told apart by its lit pad. A frame
     would show whether hover should differ from playing.
  5. Primary button hover and pressed: the accent at 85 and 70 percent, as there is no lighter or
     darker accent token.
  6. Menu item highlight: `surface` (a step down inside a raised panel), since the spec has no fourth,
     lighter surface.
  7. Empty and error states: centred in a panel with a 40 px pad-shaped icon well.
  8. Engraved column headers: WAVE, TITLE, TAGS, KEY, BPM, BARS; on phone the key sits under the BPM.
  9. Progress steps: horizontal, labels UPLOAD, ANALYZE, READY and FLAGGED, success hue for done.
  10. Proportions of overlays: dialog 440 px wide with 24 px padding; toasts stack bottom right,
      above the player bar.
  11. Shortcuts shown in tooltips: L (like), D (download); menu items Q (queue) and C (copy link).
      The key map belongs to the shortcuts dialog (`?`); these are placeholders until it exists.
  12. Waveform bar height is linear in the peak value. The synthetic fixtures are percussive, so rows
      look spiky; a frame with a real loop would show whether a perceptual curve is wanted.
- **Gallery states without interaction.** Hover, focus and pressed are drawn with `data-hover`,
  `data-focus` and `data-active` through the `ui-hover` / `ui-active` variants, which also match the
  real states, so the frozen and live looks cannot drift. Open overlays are shown as `inert` pictures
  built from the same surface components (`DialogSurface`/`DialogPreview`, `MenuPreview`,
  `TooltipSurface`, `ToastSurface`/`ToastPreview`), because a fixed-position Radix popper in a
  full-page screenshot is unreliable; live triggers sit beside them.
- **Danger and type colors only on measured pairs.** Danger hover is `raised`; pressed is the type
  color's own 16 percent tint, the pair chips already use. Tag chips sit on `bg` so they read on both
  surface and raised rows.
- **Skeletons do not pulse**: the spec allows only the loading ring and the logo to loop.
- **Lint rule `react-hooks/static-components`** flagged `<L />` where `L` comes from context;
  `UiLink` uses `createElement(useContext(LinkContext), props)` instead. No rule was disabled.
- **Avatar initials render on the server** when there is no picture; Radix's fallback appears only
  after mount, which would flash an empty disc.
- **next/link prefetches** the gallery's sample links (/loop/..., /u/..., /licenses), which 404 until
  those routes exist. Harmless in the gallery.
- **Docker**: the daemon was not running in this container; I started `dockerd`. The pinned
  mcr.microsoft.com/playwright:v1.63.0-noble image was already present.

## Requests filed
- docs/requests/131-ring-duration-token.md: a motion token for the loading ring's turn (800 ms used
  meanwhile in components.css, named as the single exception in components-css.test.ts).

## Review round (PR #5)

Fixed as new commits on lane/interface-131 (no force-push), after merging origin/phase-0/foundations
(5321936; brings the same-site ItemRow.href contract and e2e ownership).

### Blocking
- **D1, tab focus ring clipped.** Tab is `px-2 -outline-offset-2`, and components.css adds
  `[role="tab"][data-focus] { outline-offset: -2px }` so the frozen ring matches the real one.
  TabList is `-mx-2 gap-2`, and the underline is `after:inset-x-2`. On the phone the strip
  fades its last stretch (`max-tablet:mask-r-from-80%`, Tailwind's own mask utility), so Presets,
  which sits past the edge at 380 px, reads as more to scroll to. The frozen focus is now on Kits,
  so it stays in view at every width.
- **T1, one full-page screenshot.** e2e/visual/screens.spec.ts now takes one screenshot per
  gallery section (5 token sections + 19 component sections, at 3 widths, plus home), each with
  `maxDiffPixels: 0, maxDiffPixelRatio: 0`. The three old gallery-visual-*.png baselines are
  deleted. e2e/journeys/gallery.spec.ts checks:
  - section order;
  - that each section's captions carry the state words the design spec lists (the list is in
    e2e/gallery-sections.ts);
  - that the frozen states carry the attributes that draw them.
- **T2, keyboard checks not committed.** They are now committed as
  e2e/journeys/gallery-keyboard.spec.ts, scoped to the live specimens:
  - waveform arrows, Shift, Home and End;
  - confirm dialog: focus trap, axe, Escape and focus return;
  - form dialog: Enter submits, and the dialog cannot be closed while it saves;
  - menu: Enter opens it, it skips the disabled item and does not wrap;
  - tabs: arrows, Home and End;
  - tooltip on keyboard focus;
  - toast in the Notifications region;
  - live row: play, like and context menu.

  The key map is a pure `seekFromKey` in waveform-bars.ts, unit-tested, including clamping and
  unknown keys. The keyboard spec also passed with `--repeat-each=5`.

### Design advisories
- Bars use perceptual height: slice maximum, then `loudness` (square root), with a 2 px floor.
- Ghost "on" state is `aria-pressed:bg-raised`. The specimen row uses one icon (Heart, Like).
- The gallery tooltip shortcut reads D.
- The Flagged step is neutral. Only a failed step is red.
- Disabled ghost buttons and icon buttons keep a transparent border and background.
- BARS cells show the bare number. The unit is in the header, and the full text ("2 bars") is
  given to screen readers.
- Added a frozen context-menu MenuPreview ("context, open"). Live rows use the same entries.
- Phone tab strip: the end fade described under D1.
- The hero error text is "Waveform unavailable. Play still works."

### Contract advisories
- describeRow uses TYPE_LABEL.
- `uploadStepFor(status, job)` sits next to progress-steps and is unit-tested for every
  ItemStatus.
- react and react-dom are peerDependencies of @stash/ui (^19.3.0).

### Test advisories
- The disabled attribute is asserted with a regex.
- test/components-states.test.ts covers Tabs, Menu and MenuPreview, Tooltip, Toast tone icons and
  Skeletons.
- It also covers these edge cases:
  - malformed peaks;
  - progress outside 0..1;
  - null and non-finite durationMs;
  - empty initials;
  - formatCount boundaries;
  - ResultRow with null peaks, bpm and key, and with 0 or 1 tags.
- These tests found that Stat lacked aria-busy while its value was undefined. That is fixed.

### Check output
```
$ pnpm check
packages/contracts typecheck: Done
packages/audio typecheck: Done
packages/ui typecheck: Done
apps/web typecheck: Done
(eslint . --max-warnings 0: no output)

$ pnpm test
Test Files  8 passed (8)
Tests  178 passed (178)
Start at  23:06:14
Duration  1.41s (tests 49%, import 41%, transform 10%, worker 1%)

$ pnpm e2e
  ✓   2 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:19:1 › hero waveform seeks with arrows, Shift, Home and End (1.0s)
  ✓   1 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:38:1 › confirm dialog takes focus, keeps it, closes on Escape and returns it (1.8s)
  ✓   4 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:72:1 › overflow menu opens from the keyboard, skips the disabled item, does not wrap (1.3s)
  ✓   3 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:55:1 › form dialog submits on Enter and cannot be closed while it saves (2.8s)
  ✓   5 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:93:1 › tabs move with arrows, Home and End, skipping the disabled tab (883ms)
  ✓   6 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:110:1 › tooltip opens on keyboard focus with its shortcut (1.0s)
  ✓   7 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:124:1 › a toast with undo appears, announced in the notifications region (1.3s)
  ✓   9 [e2e] › e2e/journeys/gallery.spec.ts:12:1 › every component section is on the gallery, in order (246ms)
  ✓  10 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Button shows every state the design spec lists (354ms)
  ✓   8 [e2e] › e2e/journeys/gallery-keyboard.spec.ts:134:1 › a live row plays, likes and opens its context menu (1.2s)
  ✓  11 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Icon button shows every state the design spec lists (319ms)
  ✓  12 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Play button shows every state the design spec lists (343ms)
  ✓  13 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Text and search input shows every state the design spec lists (348ms)
  ✓  14 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Chip shows every state the design spec lists (311ms)
  ✓  15 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › License badge shows every state the design spec lists (355ms)
  ✓  16 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Avatar shows every state the design spec lists (347ms)
  ✓  17 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Uploader card shows every state the design spec lists (383ms)
  ✓  18 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Stat shows every state the design spec lists (387ms)
  ✓  19 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Tabs shows every state the design spec lists (433ms)
  ✓  20 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Dialog shows every state the design spec lists (421ms)
  ✓  21 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Menu shows every state the design spec lists (375ms)
  ✓  22 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Tooltip shows every state the design spec lists (352ms)
  ✓  23 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Toast shows every state the design spec lists (386ms)
  ✓  24 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Skeleton shows every state the design spec lists (355ms)
  ✓  25 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Empty state and error state shows every state the design spec lists (329ms)
  ✓  26 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Progress steps shows every state the design spec lists (322ms)
  ✓  27 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Result row, loop shows every state the design spec lists (343ms)
  ✓  28 [e2e] › e2e/journeys/gallery.spec.ts:18:3 › Waveform shows every state the design spec lists (368ms)
  ✓  30 [e2e] › e2e/journeys/smoke.spec.ts:13:1 › health route returns the contract shape (23ms)
  ✓  29 [e2e] › e2e/journeys/gallery.spec.ts:26:1 › frozen states carry the attributes that draw them (462ms)
  ✓  31 [e2e] › e2e/journeys/smoke.spec.ts:19:1 › home renders the wordmark (588ms)
  ✓  33 [e2e] › e2e/journeys/smoke.spec.ts:33:1 › pages refuse to be framed (10ms)
  ✓  32 [e2e] › e2e/journeys/smoke.spec.ts:25:1 › the gallery renders every token and is not indexed (1.8s)
  33 passed (18.3s)

$ pnpm visual
  75 passed (26.1s)

$ pnpm run licenses
All dependency licenses are on the allowed list.
```
