import { describe, expect, it } from "vitest";
import { joinFaults, joinReport, maxWindowedDifference } from "../test-page/join-metrics.ts";

const SR = 44100;
const sine = (n: number, f = 220, phase = 0) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / SR + phase));
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("join metrics for the seamless-loop test", () => {
  it("passes a continuous join", () => {
    const x = sine(SR);
    expect(joinFaults(joinReport(x, SR / 2, SR))).toEqual({ gap: false, click: false });
  });
  it("flags a gap: 20 ms of silence at the join (undecoded MP3 padding)", () => {
    const a = sine(SR / 2);
    const x = concat(a, new Float32Array(882), sine(SR / 2, 220, (2 * Math.PI * 220 * (SR / 2)) / SR));
    expect(joinFaults(joinReport(x, SR / 2, SR)).gap).toBe(true);
  });
  it("flags a click: the waveform jumps at the join (loop played on the wrong length)", () => {
    const x = concat(sine(SR / 2), sine(SR / 2, 220, Math.PI / 2));
    const faults = joinFaults(joinReport(x, SR / 2, SR));
    expect(faults.click).toBe(true);
    expect(faults.gap).toBe(false);
  });
  it("does not flag a jump the loop also has elsewhere", () => {
    const seg = (phase: number) => sine(SR / 4, 220, phase);
    const x = concat(seg(0), seg(Math.PI / 2), seg(Math.PI), seg(0));
    expect(joinFaults(joinReport(x, (3 * SR) / 4, SR)).click).toBe(false);
  });
  it("measures only the requested range", () => {
    const x = concat(new Float32Array(SR / 4), sine(SR));
    expect(joinFaults(joinReport(x, SR, SR, { start: SR / 2 })).gap).toBe(false);
  });
  it("windowed difference is 0 for identical renders and finds where two differ", () => {
    const a = sine(SR);
    expect(maxWindowedDifference(a, a, 0, SR, SR).max).toBe(0);
    const b = a.slice();
    for (let i = 30000; i < 30100; i++) b[i] = 0;
    const d = maxWindowedDifference(b, a, 0, SR, SR);
    expect(d.max).toBeGreaterThan(0.1);
    expect(Math.abs(d.at - 30000)).toBeLessThan(441);
  });
});
