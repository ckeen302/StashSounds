# 0007 License exceptions
- Context: The licenses gate allows permissive licenses for anything we ship. Three families fall outside that list.
- Options: Drop the packages; allow named exceptions.
- Choice: Allowed by name in scripts/licenses.mjs:
  - `@fontsource-variable/*` under OFL-1.1. The SIL Open Font License covers the Inter and JetBrains Mono font files; embedding them in a web app is what it is for.
  - `@img/sharp-libvips-*` under LGPL-3.0-or-later. Next's image optimizer loads this prebuilt library dynamically and unmodified.
  - Development-only data packages under CC-BY-3.0 (SPDX license lists used by tooling).
- Reason: None of these put obligations on Stash's own source.
- Consequence: Any other new copyleft dependency fails the gate and needs its own decision.
