# Design spec

> Source: Stash MVP Build Documentation (23 Nov 2026), Tab 1 ("UI and design direction") and Design spec. Where this file and the code disagree, raise it with the lead; do not silently pick one.

## UI and design direction

The interface should feel like a piece of studio gear: dark, dense, fast, and built around the waveform rather than around cards and cover art. A producer should be able to tell what the site is for from a screenshot with the text blurred.

### Principles

- The sound is the picture. Every item is drawn as its own waveform, piano roll or pad grid. No stock imagery, no placeholder cover art.
- Rows, not cards. Search results are compact rows, around 56 px tall, so 12 or more fit on a laptop screen. Auditioning 50 sounds should need no scrolling gymnastics.
- One accent, five type colors. A single accent marks the playing state and primary actions. Each content type has its own hue, used only for its waveform and type chip.
- Numbers in monospace. BPM, key, bars and duration sit in fixed columns so the eye can scan down them.
- Keyboard first. Every action on a result row has a key. Show the shortcut in the tooltip.
- Motion is feedback only. Playhead, pad flash, like confirmation. 120 to 200 ms, nothing decorative.

### Starting tokens

These are a starting point for `packages/ui`; adjust once you see them on real screens.

| Token | Value | Use |
| --- | --- | --- |
| bg | #0B0B0D | Page background |
| surface | #141418 | Rows, panels, player bar |
| raised | #1D1D23 | Hover, menus, dialogs |
| border | #2A2A33 | Hairlines and dividers |
| text | #F2F2F5 | Primary text |
| text-muted | #9A9AA8 | Metadata, labels |
| accent | #C8FF3E | Play state, primary buttons, focus ring |
| type-loop | #5EC8FF | Loop waveforms and chips |
| type-oneshot | #FF8A4C | One-shot waveforms and chips |
| type-kit | #FF5C8A | Kit pads and chips |
| type-midi | #B18CFF | Piano-roll notes and chips |
| type-preset | #4CE0B3 | Preset demos and chips |
| Font, UI | Inter or Geist, 14 px base | All interface text |
| Font, numeric | JetBrains Mono or Geist Mono | BPM, key, time, counts |
| Spacing | 4 px grid | All padding and gaps |
| Radius | 6 px controls, 10 px panels | Consistent corners |

Check every text and background pair for a contrast ratio of at least 4.5 to 1 before locking these in.

### Screens

| Screen | What it must do |
| --- | --- |
| Home | Following feed and trending, as playable rows. A signed-out visitor hears something within one click. |
| Browse and search | Type tabs, filters for BPM range, key, genre and tags, sort by new or trending. Filters live in the URL so every view is shareable. |
| Item page | Large player for the type, metadata, license badge, download, like, uploader card with follow, more from this uploader, similar items. |
| Kit page | Pad grid, sample list with per-sample play and download, demo pattern. |
| Profile | Header with follow, tabs per content type, totals. |
| Upload | Drop zone, live processing status, auto-filled metadata to confirm, license picker, publish. Multiple files at once. |
| Reference page | Everything tagged "in the style of" one artist or song, grouped by content type. |
| Player bar | Fixed to the bottom on every screen: current item, waveform, transport, tempo, key, volume, queue. |
| Admin | Review queue, reports, takedowns, user suspension. Plain is fine. |

### Rules for the agents building UI

- Colors, spacing and type sizes come only from tokens. A raw hex value in a component fails review.
- Shared components live in `packages/ui`. A page may compose them, not restyle them.
- Every interactive element has hover, focus, active, disabled and loading states.
- Every list has an empty state and a skeleton loading state.
- Honor reduced-motion settings and keep all controls reachable by keyboard.
- Design the phone layout for each screen at the same time as the desktop one, at 380 px wide.

## Design spec

The interface should read as a piece of studio hardware: matte black, one lit accent, engraved labels, a tight grid, and the sound itself as the only imagery. This tab is the rulebook the Interface agent and the design reviewer both work from.

The visual target for these rules is the Stash: key screens canvas: browse, loop page, kit page, upload and profile at 1440 px wide. Export those five frames into `docs/design/refs/` in step 0 so the Interface builder and the design reviewer work from the same pictures.

## Concept and signature

The concept is a sampler you can scroll. Four elements carry it, and together they should make any screenshot recognizable with the text blurred.

| Element | What it is | Where it appears |
| --- | --- | --- |
| The sound as the image | Every item is pictured by its own waveform, piano roll or pad grid, drawn in its type color | Rows, item pages, share images, profile grids. There is no cover art and no stock imagery anywhere. |
| One lit thing | The accent color means "this is live". Only the playing item, the playhead and the primary action carry it. | At most one lit element per screen region. If two things glow, one is wrong. |
| Engraved labels | Tiny uppercase monospace labels, like the legends printed on hardware: `BPM`, `KEY`, `BARS`, `LEN` | Above every number, on column headers, on the player bar |
| The pad | A square, slightly inset control with a hairline border | Play buttons, kit pads, type chips, and the logo |

### Logo direction

A lowercase wordmark, `stash`, set in the interface font at heavy weight with tight spacing. The mark is a two-by-two grid of pads with one pad lit in the accent. It works at 16 pixels as a favicon and scales up as the loading state, where the lit pad steps around the grid.

### What it is not

Not a streaming app with album art. Not a marketplace with product cards and prices. Not a social feed with large photos. If a screen starts to resemble one of those, it has drifted from the concept.

## Layout and grid

The frame is the same on every screen: a rail on the left, a bar on top, content in the middle, the player fixed to the bottom. Only the content area scrolls.

### Frame, by width

| Part | Desktop, 1024 and up | Tablet, 640 to 1023 | Phone, under 640 |
| --- | --- | --- | --- |
| Navigation | Left rail, 232 px, collapsible to 64 | Left rail, icons only, 64 px | Bottom tab bar, 56 px: Home, Browse, Upload, Library, Profile |
| Top bar | 56 px: search centered up to 560 px wide, notifications, avatar | Same | 48 px: logo, search icon, notifications |
| Content | Max 1280 px, 24 px side padding | 16 px side padding | 12 px side padding |
| Player | Bar, 72 px, full width | Bar, 64 px | Mini player, 56 px, above the tab bar; tap opens a full-screen sheet |

Spacing uses one scale everywhere: 4, 8, 12, 16, 24, 32, 48, 64. Nothing sits between those values.

### The result row

The row is the most-seen element in the product, so its anatomy is fixed. Columns line up down the whole list, under a header row of engraved labels.

| Slot | Width | Content | Drops out at |
| --- | --- | --- | --- |
| Play | 40 px | Pad-shaped play button; shows a ring while loading | Never |
| Waveform | 200 px | Mini waveform, piano roll strip or kit pattern strip in the type color; click to scrub | Phone |
| Title | Flexible | Title in medium weight, uploader handle beneath in muted text | Never |
| Tags | Up to 2 chips | First two tags | Tablet |
| Key | 56 px | Monospace, such as F#m | Never; merges with BPM on phone |
| BPM | 56 px | Monospace, right-aligned digits | Never |
| Length | 56 px | Bars for loops and MIDI, seconds for one-shots, sample count for kits | Tablet |
| Actions | 3 x 32 px | Like, download, more; visible on hover or selection, always visible on touch | Phone moves them to a long-press sheet |

A row is 56 px tall on desktop and 64 px on phone. The row that is playing has the lit accent on its play button and a faint raised background; the selected row has a 2 px accent bar on its left edge.

### Item page

Two columns on desktop. The left, two thirds wide, holds the title, the hero player for the type and the controls directly under it. The right holds the uploader card with follow, the license badge with a one-line plain-language summary, the download and like buttons, and the metadata list. Below both: more from this uploader, then similar items, each as rows.

On phone it becomes one column in that same order, with download pinned above the mini player.

### Upload

A single drop zone that fills the content area when empty. Once files are added, each becomes a card that moves through three visible steps: uploading with a progress bar, analyzing with the detected values appearing as they arrive, and ready with editable fields. One publish button per card and one for all.

## Type and color

Seven text styles and thirteen colors cover the whole product. Every text and background pair below was measured and clears the 4.5 to 1 contrast ratio that accessibility guidelines ask of body text.

### Type scale

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | 40 / 44 px; 28 / 32 on phone | 600 | Item titles on item pages, profile names |
| Title | 20 / 28 px | 600 | Section headings |
| Body strong | 14 / 20 px | 500 | Row titles, button labels |
| Body | 14 / 20 px | 400 | Default text |
| Small | 13 / 18 px | 400 | Uploader handles, metadata, help text |
| Numeric | 13 / 18 px, monospace, tabular figures | 500 | BPM, key, bars, time, counts |
| Label | 11 / 16 px, monospace, uppercase, 0.06 em letter spacing | 500 | Engraved labels and column headers |

Use one sans-serif family and its matching monospace, self-hosted: Geist with Geist Mono, or Inter with JetBrains Mono. The mockups use Inter with JetBrains Mono; keep that pair unless you change it on purpose in step 0.

### Colors and measured contrast

| Token | Value | On bg | On surface | On raised |
| --- | --- | --- | --- | --- |
| text | #F2F2F5 | 17.6 | 16.4 | 15.0 |
| text-muted | #9A9AA8 | 7.1 | 6.6 | 6.0 |
| accent | #C8FF3E | 16.7 | 15.6 | |
| type-loop | #5EC8FF | | 9.8 | 8.9 |
| type-oneshot | #FF8A4C | | 7.9 | 7.2 |
| type-kit | #FF5C8A | | 6.3 | 5.7 |
| type-midi | #B18CFF | | 7.1 | 6.4 |
| type-preset | #4CE0B3 | | 11.0 | 10.1 |
| border-strong | #6B6B78 | 3.8 | 3.5 | 3.2 |
| border | #2A2A33 | 1.4 | 1.3 | |

Backgrounds are bg #0B0B0D, surface #141418 and raised #1D1D23. Text placed on the accent uses `bg`, at 16.7 to 1. The plain border is decorative and too faint to mark a control's edge, so inputs and other controls that rely on their outline use `border-strong`, which clears the 3 to 1 asked of control boundaries.

### Color rules

- Accent means live. Playing state, playhead, primary action, focus ring. Never a decoration, never a heading color.
- Type colors belong to the sound. Full strength on waveforms, notes and pads; at 16 percent opacity as a chip background with the full color as chip text. Never on body text or buttons.
- Three surface levels only. Page, panel, raised. Depth comes from those steps and hairline borders, not from shadows.
- Danger and success reuse `type-kit` and `type-preset` hues for destructive and confirmed states, always paired with an icon or word so color is never the only signal.
- Dark only for the MVP. The tokens are named by role, so a light theme can be added later by swapping values.

## Components

The product is built from 30 components in `packages/ui`. A screen composes them; it never restyles them. Each must appear in the gallery in every state listed before a screen is allowed to use it.

| Group | Component | Variants | States beyond default |
| --- | --- | --- | --- |
| Actions | Button | Primary, secondary, ghost, danger; 32 and 40 px | Hover, focus, pressed, disabled, loading |
| Actions | Icon button | Ghost, pad | Hover, focus, pressed, disabled, on |
| Actions | Play button | Row size 40 px, hero size 64 px | Loading ring, playing (lit), paused, error |
| Inputs | Text input, search input | With icon, with shortcut hint | Focus, filled, invalid with message, disabled |
| Inputs | Select and combobox | Single, multi with chips | Open, focus, empty results |
| Inputs | Slider | Tempo, volume, range for BPM filter | Hover, dragging, focus, disabled |
| Inputs | Stepper | Key shift in semitones | At limit, focus |
| Inputs | Drop zone | Empty page, compact | Drag over, rejecting, uploading |
| Display | Chip | Type, tag, filter | Selected, removable, hover |
| Display | License badge | Three licenses | Hover shows the summary |
| Display | Avatar | 24, 32, 64, 96 px | Fallback initials, loading |
| Display | Uploader card | Compact, full | Following, own profile |
| Display | Stat | Label over number | Loading |
| Sound | Result row | One per content type | Hover, selected, playing, loading, skeleton |
| Sound | Waveform | Mini, hero | Loading from peaks, playing, scrubbing, error |
| Sound | Piano roll | Strip, hero | Playing, empty |
| Sound | Pad and pad grid | 4 by 4, compact dots | Hover, hit flash, loading, empty pad |
| Sound | On-screen keyboard | Two octaves, shows computer-key hints | Key down, out of range |
| Sound | Transport | Tempo, key, loop, volume | Disabled for types that lack a control |
| Sound | Player bar | Desktop bar, phone mini, phone sheet | Idle, loading, playing, error |
| Structure | Tabs | Underline | Selected, focus, with count |
| Structure | Dialog | Confirm, form | Loading, error |
| Structure | Sheet | Phone bottom sheet | Dragging |
| Structure | Menu | Context, overflow | Open, focus, disabled item |
| Structure | Tooltip | With shortcut key | |
| Feedback | Toast | Info, success, error, with undo | Entering, leaving |
| Feedback | Skeleton | Row, card, text | |
| Feedback | Empty state | With one next action | |
| Feedback | Error state | With retry | |
| Feedback | Progress steps | Uploading, analyzing, ready, flagged | Active, done, failed |

### Rules for building them

- Start from accessible primitives. Dialogs, menus, selects, tabs and tooltips are built on a headless library so focus handling and keyboard behavior are correct from the start. Style comes only from tokens.
- The four sound components draw on canvas, sized for the screen's pixel density, and redraw only what changed.
- Controls are 32 or 40 px tall. Radius is 6 px on controls and 10 px on panels. Borders are 1 px.
- Icons come from one outline set at 16 and 20 px with a 1.5 px stroke. No filled icons, no emoji.
- Every interactive element shows a visible focus ring: 2 px accent, offset 2 px.

## The signature views

Three drawings carry the product's identity: the waveform, the piano roll and the pad grid. They get the most care, the most polish passes and the strictest review.

### Waveform

| Property | Mini, in rows | Hero, on item pages |
| --- | --- | --- |
| Size | 200 by 32 px | Full column width by 120 px; 88 px on phone |
| Form | Vertical bars mirrored around the center line, 2 px wide with a 1 px gap, rounded ends | Same, 3 px wide with a 1 px gap |
| Color | Type color at 35 percent before the playhead passes, full strength after | Same |
| Playhead | None; the color change is the playhead | 1 px accent line with the current time above it in the numeric style |
| Hover | Brightens; cursor shows a scrub position | A ghost line follows the pointer with its time |
| Loop markers | None | Bar lines as faint ticks along the bottom, from BPM and loop length |
| Loading | Bars at uniform low height, drawn from stored peaks the moment the row renders | Same; audio state shows on the play button, not the waveform |

Bars are computed from the 800 stored peaks by taking the maximum within each bar's slice. Very quiet passages keep a minimum bar height of 2 px so the shape never vanishes.

### Piano roll

| Property | Rule |
| --- | --- |
| Notes | Rounded rectangles in `type-midi`. Opacity carries velocity, from 45 percent at the softest to 100 at the hardest. |
| Vertical range | Fitted to the notes used, plus two semitones of padding, never less than one octave |
| Grid | Faint line per beat, slightly stronger per bar. Rows for black keys are one step darker. |
| Key gutter | Hero only: a narrow piano keyboard down the left edge, with C notes labeled |
| Playhead | 1 px accent line; notes brighten as it crosses them |
| Strip, in rows | The same notes in 200 by 32 px, no grid, no gutter |
| Interaction | Click to start from that beat. No editing in the MVP. |

### Pad grid

| Property | Rule |
| --- | --- |
| Layout | Four by four square pads, 8 px gaps, the whole grid as wide as the hero column up to 480 px |
| Pad face | `surface` fill, 1 px border, the sample's name in small text bottom left, its computer key as an engraved label top right |
| Category | A 2 px line along the pad's top edge, tinted by category so kicks, snares, hats and 808s can be told apart at a glance |
| Hit | The pad fills with `type-kit` for 80 ms and fades over 160 ms. Sound starts on press, not release. |
| Keys | Rows `1234`, `QWER`, `ASDF`, `ZXCV` map to the grid from top to bottom |
| Beyond sixteen | Further samples are listed below as rows, each with its own play and download |
| Demo pattern | A play control above the grid runs a short built-in pattern at a chosen BPM; pads flash as they fire |
| In rows | A sixteen-step strip with four lanes, lit where the kit's demo pattern hits |

### Preset keyboard

Two octaves of keys beneath the demo waveform. White keys are `surface`, black keys are `bg`, and a pressed key fills with `type-preset`. The computer keyboard's home row plays white notes and the row above plays black notes, with Z and X shifting the octave.

Presets without rendered notes show the demo only, with a line explaining that playable preview is available for Vital presets.

## Motion, voice and accessibility

Motion confirms what the user just did, the words sound like a producer wrote them, and everything works from the keyboard. These three are where an interface goes from correct to finished.

### Motion

| Moment | Motion | Duration |
| --- | --- | --- |
| Hover and press on controls | Background and border color change | 120 ms |
| Play starts | The play button's ring closes and lights | 160 ms |
| Pad hit | Fill, then fade | 80 ms in, 160 ms out |
| Like | The icon fills with a single small scale pulse | 200 ms |
| Row selection moves | The accent bar slides to the new row | 120 ms |
| Dialogs, menus, sheets | Fade with a 4 px rise; sheets slide from the bottom | 160 to 200 ms |
| New row arrives in a feed | Fades in; nothing already on screen moves | 200 ms |
| Playhead and waveform fill | Follow audio position every frame | Continuous |

Nothing animates on page load. Nothing loops except the loading ring and the logo's loading state. All easing is a standard ease-out. With reduced motion switched on, everything but the playhead becomes an instant change.

### Voice

- Short and plain. "Upload", "Download", "Follow". No exclamation marks, no emoji, no marketing adjectives.
- Producer vocabulary, used correctly: loop, one-shot, kit, 808, preset, bars, key, BPM.
- Errors say what happened and what to do. "This file is longer than 60 seconds. Trim it and upload again."
- Empty states point somewhere. "Nothing liked yet. Press L on anything you want to keep."
- Flags are honest. "This matches something already on Stash. If it is yours, tell us and we will review it."
- Sentence case everywhere except the engraved labels.

### Accessibility

- Keyboard: every action reachable without a mouse, in a visible and logical focus order. Shortcuts are listed in a dialog opened with `?`.
- Instrument pages: on kit and preset pages the letter keys play sounds, so like and download move to Shift+L and Shift+D there.
- Screen readers: the player announces title, uploader and state. Waveforms, piano rolls and pads are described in text: type, length, BPM and key. Each pad is a labeled button.
- Touch: targets are at least 40 px. Nothing depends on hover.
- Contrast: the measured pairs in this tab are the only allowed text and background combinations.
- Sound: nothing plays without a user action, and the volume setting is remembered.
- Automated checks run on every changed screen in the end-to-end tests, and a manual keyboard-only pass is part of every polish ticket.
