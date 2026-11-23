import { describe, expect, it } from "vitest";
import { decodePeaks, encodePeaks } from "@stash/contracts";
import { barHeight, barLayout, barValues, formatTime, fractionAt, MIN_BAR_HEIGHT } from "../src/components/waveform-bars.ts";

describe("waveform bars (design spec: Waveform)", () => {
  it("fits 2 px bars with a 1 px gap into the 200 px mini", () => {
    // 67 bars use 67 * 3 - 1 = 200 px exactly.
    expect(barLayout(200, "mini")).toEqual({ count: 67, offset: 0, step: 3 });
  });

  it("fits 3 px bars with a 1 px gap into the hero and centres the remainder", () => {
    const { count, offset, step } = barLayout(642, "hero");
    expect(step).toBe(4);
    expect(count).toBe(160);
    expect(offset).toBe(Math.floor((642 - (160 * 4 - 1)) / 2));
  });

  it("draws nothing in no width", () => {
    expect(barLayout(0, "mini").count).toBe(0);
  });

  it("takes the maximum of each bar's slice of the 800 peaks", () => {
    const peaks = new Uint8Array(800);
    peaks[5] = 255; // inside the first of 8 slices (0 to 99)
    peaks[150] = 51; // inside the second
    const v = barValues(peaks, 8);
    expect(v[0]).toBe(1);
    expect(v[1]).toBeCloseTo(0.2);
    expect(Array.from(v.slice(2))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("works from the stored base64 peaks", () => {
    const encoded = encodePeaks(Array.from({ length: 800 }, (_, i) => (i < 400 ? 128 : 255)));
    const v = barValues(decodePeaks(encoded), 2);
    expect(v[0]).toBeCloseTo(128 / 255);
    expect(v[1]).toBe(1);
  });

  it("covers every peak when there are more bars than peaks", () => {
    const v = barValues(new Uint8Array([0, 255]), 4);
    expect(Array.from(v)).toEqual([0, 0, 1, 1]);
  });

  it("keeps quiet passages at the 2 px floor and never exceeds the canvas", () => {
    expect(MIN_BAR_HEIGHT).toBe(2);
    expect(barHeight(0, 32)).toBe(2);
    expect(barHeight(0.01, 32)).toBe(2);
    expect(barHeight(0.5, 32)).toBe(16);
    expect(barHeight(1.4, 32)).toBe(32);
  });

  it("turns a pointer position into a clamped fraction", () => {
    expect(fractionAt(50, 200)).toBe(0.25);
    expect(fractionAt(-10, 200)).toBe(0);
    expect(fractionAt(250, 200)).toBe(1);
    expect(fractionAt(10, 0)).toBe(0);
  });

  it("formats time as m:ss", () => {
    expect(formatTime(7300)).toBe("0:07");
    expect(formatTime(65_000)).toBe("1:05");
    expect(formatTime(-5)).toBe("0:00");
  });
});
