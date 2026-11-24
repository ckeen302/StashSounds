# 0009 Component sizes may sit between spacing steps; spacing may not
- Context: The design reviewer asked whether w-, h- and size- utilities should be held to the 4/8/12/16/24/32/48/64 spacing scale like padding and margin.
- Options: Lint sizes to the scale; lint sizes to a named list; leave sizes free and lint only spacing.
- Choice: Sizes are free (h-14 for a 56 px row, w-58 for the 232 px rail); padding, margin, gap, offsets and translations stay on the scale. Arbitrary values (w-[233px], w-(--x)) stay banned, so every size is still a multiple of 4 px.
- Reason: The design spec fixes component sizes (rows 56/64, controls 32/40, rail 232, player bar 72) that are not scale steps, and a named list would grow with every component.
- Consequence: packages/ui/eslint-plugin.js documents this; the design reviewer checks sizes against design-spec.md by eye.
