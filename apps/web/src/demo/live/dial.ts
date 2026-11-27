/** The home knobs' positions: tempo, key and vibe, each with "any" first. */
export const KNOB_TEMPOS = ["ANY", ...Array.from({ length: 23 }, (_, i) => String(70 + i * 5))];
export const KNOB_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const KNOB_KEYS = ["ANY", ...KNOB_ROOTS.map((r) => `${r}m`), ...KNOB_ROOTS];
export const KNOB_VIBES = ["ANY", "Dark", "Sad", "Bouncy", "Hard", "Chill", "Dreamy", "Jazzy", "Dusty", "Happy"];

/** What the three knobs dial into the search line: "dark 140 C#m", or nothing when all are on any. */
export function dialed(tempo: number, key: number, vibe: number): string {
  return [KNOB_VIBES[vibe]?.toLowerCase(), KNOB_TEMPOS[tempo], KNOB_KEYS[key]].filter((x) => x && x.toUpperCase() !== "ANY").join(" ");
}

