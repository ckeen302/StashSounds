import { describe, expect, it } from "vitest";
import { dialed, KNOB_KEYS, KNOB_TEMPOS, KNOB_VIBES } from "./dial";
import { knobAngle, stepAfterDrag, SWEEP } from "./knob";
import { parseQuery } from "../smart-search";

describe("the home knobs", () => {
  it("dial nothing when every knob is on any", () => {
    expect(dialed(0, 0, 0)).toBe("");
  });

  it("dial a search the smart search reads back as tempo, key and mood", () => {
    const t = KNOB_TEMPOS.indexOf("140");
    const k = KNOB_KEYS.indexOf("C#m");
    const v = KNOB_VIBES.indexOf("Dark");
    const q = dialed(t, k, v);
    expect(q).toBe("dark 140 C#m");
    const read = parseQuery(q);
    expect(read.bpm?.exact).toBe(140);
    expect(read.key).toEqual({ root: 1, mode: "minor" });
    expect(read.moods).toContain("Dark");
  });

  it("turn through a 270 degree sweep, end to end", () => {
    expect(knobAngle(0, 10)).toBe(-SWEEP / 2);
    expect(knobAngle(9, 10)).toBe(SWEEP / 2);
    expect(knobAngle(99, 10)).toBe(SWEEP / 2);
    expect(knobAngle(0, 1)).toBe(0);
  });

  it("land a drag on whole steps and never past either end", () => {
    expect(stepAfterDrag(3, 0, 10, 10)).toBe(3);
    expect(stepAfterDrag(3, 21, 10, 10)).toBe(5);
    expect(stepAfterDrag(3, -500, 10, 10)).toBe(0);
    expect(stepAfterDrag(3, 500, 10, 10)).toBe(9);
  });
});
