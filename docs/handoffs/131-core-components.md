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
