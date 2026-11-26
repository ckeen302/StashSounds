# 0019 Demo album covers at scale, and a nightly QA of the demo
- Context: The static demo (ticket 137) shows album art on Presets, MIDI song charts and Samples
  (8,375 songs, 7,461 sampled records). It is published as an Artifact (511 files and 256 MB a
  version, 64 MB a publish), and its first script load is budgeted. Art can only come from the iTunes
  Search API (artwork on *.mzstatic.com); MusicBrainz and Cover Art Archive are blocked. The API
  allows about 20 calls a minute from an address that other jobs share, and answers 403 past that.
  Nothing checked the built demo end to end: links, fetched files, audio, buttons.
- Options: one search per song (15,000 calls, days at the rate limit) or by artist; one cover file
  per song or sprite sheets; all cover rows on the first load or the Samples tab's loaded with it;
  e2e specs in the Playwright suite or a separate nightly script against out-demo.
- Choice:
  - `scripts/find-demo-covers.py` looks songs up by artist (artist search, then the artist's songs and
    albums, 200 each), so one artist's three calls answer all their songs; presets and MIDI songs the
    lists miss get a search of their own. It matches title and lead artist strictly, refuses karaoke,
    tribute, remix/live stand-ins and various-artists compilations, prefers the album the demo names,
    and records misses (`presets/cover-misses.json`) so later runs skip them. Answers are cached in
    `~/.cache/stash-demo-covers.json`, so a stopped run resumes. `scripts/demo-cover-gaps.mjs` counts
    what each tab lacks and writes the queue (best-known artists first).
  - Covers stay on sprite sheets (`scripts/pack-demo-covers.py`), now 12 by 12 tiles of 240 px, laid
    out in the order the tabs show the songs so a screen of cards touches few sheets.
  - Presets and MIDI rows stay in `presets/covers.json` (first load). Samples-tab rows go in
    `samples/covers.json` as compact rows with their tile, registered into `coverFor()` by
    `samples/covers.ts`, which only the lazily loaded Samples page imports.
  - A song without real art shows a fallback tile from the theme tokens: the song's initials on a
    faint tint of one of the type tokens, over the record disc that was there before.
  - `pnpm qa:nightly` (`scripts/qa-nightly.mjs`) builds or reuses out-demo, serves it, and with
    headless, muted Chromium visits every tab and a date-rotated sample of every detail-page type
    (12 a type by default; every page comes round in `total / 12` days). It flags not-found pages,
    links that resolve to no page (checked against the demo's own data, the rest opened), fetches that
    did not answer 200, mp3s that ffmpeg cannot decode, that are truncated or that peak below -50 dBFS,
    buttons whose click changes nothing (no DOM change, navigation, audio, scroll, save or copy), page
    and console errors, cover rows on no sheet, and output over the Artifact's limits. It writes
    `qa-report/report.{json,md}` (gitignored) and exits 1 on any failure.
- Reason: the rate limit makes per-song search impractical; sheets keep the file count flat; the first
  load must not grow with the Samples catalog; a nightly script against the real built output catches
  what unit tests cannot (a missing file, a crash after a click), without slowing `pnpm e2e`.
- Consequence: run `node scripts/demo-cover-gaps.mjs --queue q.json`, `python3
  scripts/find-demo-covers.py q.json`, then `python3 scripts/pack-demo-covers.py` to add covers (stop
  the finder before packing: both write `samples/covers.json`). A cover row whose file is on no sheet
  is ignored by the page and flagged by the QA. The QA's dead-button check skips chips and tabs that
  are already chosen, and reports an element it cannot click as a warning, not a failure.
