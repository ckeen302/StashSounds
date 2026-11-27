import { describe, expect, it } from "vitest";
import { drifted, rubberBand, SWIPE_PX, swipeOf } from "./gestures";

describe("phone gestures", () => {
  it("read a quick flick left as next and right as previous", () => {
    expect(swipeOf(-80, 4, 200)).toBe("next");
    expect(swipeOf(80, -6, 200)).toBe("previous");
  });

  it("ignore short, slow or mostly vertical moves", () => {
    expect(swipeOf(-(SWIPE_PX - 1), 0, 100)).toBeNull();
    expect(swipeOf(-120, 0, 1500)).toBeNull();
    expect(swipeOf(-80, 70, 200)).toBeNull();
  });

  it("let a held finger wobble a little before it counts as a scroll", () => {
    expect(drifted(3, 4)).toBe(false);
    expect(drifted(8, 8)).toBe(true);
  });

  it("let the screen follow the thumb, then resist", () => {
    expect(rubberBand(40)).toBe(40);
    expect(rubberBand(-40)).toBe(-40);
    expect(rubberBand(300)).toBeLessThan(150);
    expect(rubberBand(300)).toBeGreaterThan(72);
  });
});
