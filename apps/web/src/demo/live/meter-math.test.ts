import { describe, expect, it } from "vitest";
import { ballistics, band, BeatFinder, litSegments, logBars, meterLevel, rms } from "./meter-math";

describe("meter math", () => {
  it("reads silence as zero and full scale as one", () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(1)).toBe(1);
    expect(meterLevel(Math.pow(10, -24 / 20))).toBeCloseTo(0.5, 5);
    expect(meterLevel(1e-6)).toBe(0);
  });

  it("takes the RMS of a block", () => {
    expect(rms([])).toBe(0);
    expect(rms([1, -1, 1, -1])).toBe(1);
    expect(rms([0.5, 0.5])).toBeCloseTo(0.5);
  });

  it("jumps up at once and falls back slowly", () => {
    expect(ballistics(0.2, 0.9, 16)).toBe(0.9);
    const fell = ballistics(0.9, 0, 100);
    expect(fell).toBeLessThan(0.9);
    expect(fell).toBeGreaterThan(0.6);
    expect(ballistics(0.1, 0, 1000)).toBe(0);
  });

  it("lights whole segments, never more than the ladder has", () => {
    expect(litSegments(0, 12)).toBe(0);
    expect(litSegments(0.5, 12)).toBe(6);
    expect(litSegments(2, 12)).toBe(12);
    expect(litSegments(-1, 12)).toBe(0);
  });

  it("finds a kick over a steady bed, and not twice in one hit", () => {
    const f = new BeatFinder();
    for (let t = 0; t < 1000; t += 16) f.feed(0.15, t);
    expect(f.feed(0.6, 1000)).toBe(true);
    expect(f.feed(0.7, 1016)).toBe(false);
    for (let t = 1032; t < 1500; t += 16) f.feed(0.15, t);
    expect(f.feed(0.6, 1500)).toBe(true);
  });

  it("ignores silence and noise under the floor", () => {
    const f = new BeatFinder();
    expect(f.feed(0.05, 0)).toBe(false);
    expect(f.feed(0, 500)).toBe(false);
  });

  it("averages a band and spreads the spectrum over log bars", () => {
    const bins = new Uint8Array(1024).fill(255);
    expect(band(bins, 1, 7)).toBe(1);
    expect(band(bins, 5, 5)).toBe(0);
    const bars = logBars(bins, 16);
    expect(bars).toHaveLength(16);
    for (const b of bars) expect(b).toBe(1);
    const low = new Uint8Array(1024);
    low[2] = 255;
    const lb = logBars(low, 16);
    expect(lb[0]! + lb[1]! + lb[2]!).toBeGreaterThan(0);
    expect(lb[15]).toBe(0);
  });
});
