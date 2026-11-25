import { describe, expect, test } from "vitest";
import { CHORD_PACKS, PACK_PROGRESSIONS, packKey, packNotes, type PackProgression } from "./chord-packs";

const sample: PackProgression = {
  title: "Test",
  pack: "T",
  bpm: 140,
  key: "C minor",
  tags: ["trap", "dark"],
  rhythm: "held",
  chords: [
    ["Cm9", 4, [36, 51, 55, 58, 62]],
    ["Abmaj7", 4, [44, 55, 60, 63, 67]],
    ["Fm11", 4, [41, 56, 60, 63, 65]],
    ["G7b9", 4, [43, 53, 56, 59, 62]],
  ],
  description: "x",
};

describe("chord packs", () => {
  test("a held progression plays exactly the written voicings, one strike per chord", () => {
    const f = packNotes(sample);
    expect(f.bars).toBe(4);
    expect(f.bpm).toBe(140);
    expect(f.notes).toHaveLength(20);
    expect(new Set(f.notes.filter((n) => n[0] < 0.1).map((n) => n[2]))).toEqual(new Set([36, 51, 55, 58, 62]));
  });

  test("every rhythm keeps the notes inside the loop and the bass on each chord", () => {
    for (const rhythm of ["held", "roll", "push", "stabs", "pulse", "arp", "bounce"] as const) {
      const f = packNotes({ ...sample, rhythm });
      for (const [s, l] of f.notes) {
        expect(s, rhythm).toBeGreaterThanOrEqual(0);
        expect(s + l, rhythm).toBeLessThanOrEqual(16.01);
      }
      expect(f.notes.filter((n) => [36, 44, 41, 43].includes(n[2]) && n[3] === 92), rhythm).toHaveLength(4);
    }
  });

  test("the library is large, every progression is in a pack, and every key reads", () => {
    expect(PACK_PROGRESSIONS.length).toBeGreaterThanOrEqual(300);
    const names = new Set(CHORD_PACKS.map((p) => p.name));
    const titles = new Set<string>();
    for (const p of PACK_PROGRESSIONS) {
      expect(names.has(p.pack), p.title).toBe(true);
      expect(packKey(p), p.title).not.toBeNull();
      expect(titles.has(p.title.toLowerCase()), p.title).toBe(false);
      titles.add(p.title.toLowerCase());
      const f = packNotes(p);
      expect(f.bars === 4 || f.bars === 8, p.title).toBe(true);
    }
  });
});
