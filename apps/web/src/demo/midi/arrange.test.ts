import { describe, expect, test } from "vitest";
import { arrangeNotes } from "./arrange";

const base = {
  bpm: 120,
  chords: [
    ["C", 2, [36, 55, 60, 64]],
    ["Am", 2, [33, 57, 60, 64]],
    ["F", 4, [41, 57, 60, 65]],
  ] as [string, number, number[]][],
  hits: [[0, 0.5], [1.5, 1], [3, 0.5]] as [number, number][],
  bass: [[0, 1, 0], [2, 1, 12]] as [number, number, number][],
};

describe("song arrangements", () => {
  test("a short phrase loops to four bars and each strike plays the chord sounding then", () => {
    const f = arrangeNotes(base);
    expect(f.bars).toBe(4);
    const at = (t: number) => f.notes.filter((n) => Math.abs(n[0] - t) < 0.05 && n[2] >= 48).map((n) => n[2]);
    expect(at(0)).toEqual([55, 60, 64]);
    expect(at(3)).toEqual([57, 60, 64]); // bar 1 beat 3 is still Am
    expect(at(4)).toEqual([57, 60, 65]); // bar 2 is F
    expect(f.notes.find((n) => Math.abs(n[0] - 2) < 0.02 && n[2] < 48)?.[2]).toBe(45); // the bass an octave up on Am
  });

  test("a strike never rings past its chord, and swing pushes only the off-beats", () => {
    const f = arrangeNotes({ ...base, hits: [[1.5, 2]], swing: 0.5 });
    const c = f.notes.find((n) => Math.abs(n[0] - 1.64) < 0.005 && n[2] === 55)!; // swung from 1.5
    expect(c[0] + c[1]).toBeLessThanOrEqual(2); // cut where Am comes in
    const fChord = f.notes.find((n) => Math.abs(n[0] - 5.64) < 0.005 && n[2] === 57)!;
    expect(fChord[1]).toBeGreaterThan(1.9); // F lasts the whole bar, so the strike rings out
    expect(f.notes.find((n) => n[2] === 36)![0]).toBe(0); // on-beat bass is not swung
  });
});
