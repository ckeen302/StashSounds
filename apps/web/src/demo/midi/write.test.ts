import { describe, expect, it } from "vitest";
import { parseMidi } from "./parse";
import { writeMidi } from "./write";

describe("writeMidi", () => {
  it("writes a file the upload parser reads back to the same notes", () => {
    const file = { version: 1 as const, bpm: 140, timeSignature: [4, 4] as [number, number], bars: 1, pitchMin: 60, pitchMax: 67, drums: false, notes: [[0, 1, 60, 100], [1, 0.5, 64, 90], [2, 2, 67, 80]] as [number, number, number, number][] };
    const back = parseMidi(writeMidi(file, "Test"), "test.mid");
    expect(back.notes.bpm).toBeCloseTo(140, 0);
    expect(back.notes.notes).toEqual(file.notes);
  });
});
