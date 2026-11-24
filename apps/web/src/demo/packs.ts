/**
 * This week's packs: loops picked by hand to work together, plus the MIDI that fits them (found
 * with the same search producers use, so a pack grows as the MIDI library does).
 */

export type Pack = {
  id: string;
  name: string;
  blurb: string;
  /** Loop titles, in the order they play. */
  loops: string[];
  /** A search over the MIDI library for the patterns and song chords that fit. */
  midi: string;
};

export const PACK_WEEK = "Week of Nov 24";

export const PACKS: Pack[] = [
  {
    id: "dark-trap",
    name: "Dark trap starter",
    blurb: "Minor-key piano and bells, a gliding 808 and hat rolls. Everything sits at 140 or 150.",
    loops: ["Dark trap piano", "Dark trap piano with drums", "Midnight keys", "Trap bells in F sharp", "Gliding 808 in A minor", "Trap drums with hat rolls"],
    midi: "dark trap",
  },
  {
    id: "plugg",
    name: "Plugg and pluggnb",
    blurb: "Soft major-seven chords and bouncy bell melodies with room for the 808 underneath.",
    loops: ["Plugg chords", "Pluggnb bells", "Melodic trap arp"],
    midi: "plugg",
  },
  {
    id: "boom-bap",
    name: "Boom bap Sunday",
    blurb: "Dusty soul chops, a jazzy Rhodes and swung drums at 90.",
    loops: ["Dusty soul chops", "Boom bap Rhodes", "Boom bap Rhodes with drums", "Swung boom bap drums", "Lo-fi nines"],
    midi: "boom bap",
  },
  {
    id: "drill",
    name: "Drill night",
    blurb: "Dark strings, a sliding lead and skippy drums at 142.",
    loops: ["Drill strings", "Drill strings with drums", "Sliding drill lead", "Drill drums with rolls"],
    midi: "drill",
  },
  {
    id: "rnb",
    name: "Late night R&B",
    blurb: "Warm pads and neo soul keys for slow songs.",
    loops: ["Late night R&B pad", "Late night R&B chords", "Neo soul keys"],
    midi: "r&b",
  },
  {
    id: "phonk",
    name: "Memphis phonk",
    blurb: "Cowbell lines and hard 808s. Push them through distortion.",
    loops: ["Phonk cowbell", "Phonk cowbell and 808", "Rage stabs"],
    midi: "phonk",
  },
];

export function pack(id: string): Pack | null {
  return PACKS.find((p) => p.id === id) ?? null;
}
