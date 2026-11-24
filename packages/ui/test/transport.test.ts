import { describe, expect, it } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { limits } from "@stash/contracts";
import {
  semitoneText,
  Stepper,
  tempoRange,
  TooltipProvider,
  Transport,
  TRANSPOSE_LIMIT,
  transposedKey,
} from "../src/index.ts";

const html = (el: ReactElement) => renderToStaticMarkup(h(TooltipProvider, null, el));

describe("transport maths", () => {
  it("names the key a shift lands on, wrapping around the octave", () => {
    expect(transposedKey({ root: 2, mode: "minor" }, 0)).toBe("Dm");
    expect(transposedKey({ root: 2, mode: "minor" }, 2)).toBe("Em");
    expect(transposedKey({ root: 11, mode: "major" }, 1)).toBe("C");
    expect(transposedKey({ root: 0, mode: "major" }, -1)).toBe("B");
    expect(transposedKey({ root: 9, mode: "minor" }, -12)).toBe("Am");
    expect(transposedKey(null, 3)).toBeNull();
  });

  it("prints a shift with its sign, and the true minus sign", () => {
    expect(semitoneText(0)).toBe("0");
    expect(semitoneText(3)).toBe("+3");
    expect(semitoneText(-2)).toBe("−2");
  });

  it("offers half to double speed, inside the contract's BPM range", () => {
    expect(tempoRange(90)).toEqual({ min: 45, max: 180 });
    expect(tempoRange(60)).toEqual({ min: limits.bpm.min, max: 120 });
    expect(tempoRange(200)).toEqual({ min: 100, max: limits.bpm.max });
  });

  it("matches the engine's transpose clamp", () => {
    expect(TRANSPOSE_LIMIT).toBe(12);
  });
});

describe("Stepper", () => {
  const base = { label: "Key shift", value: 0, min: -12, max: 12, format: semitoneText };

  it("is a labelled group with a live readout between its two buttons", () => {
    const out = html(h(Stepper, { ...base, value: 2, valueText: "Em, up 2 semitones", onChange: () => {} }));
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Key shift"');
    expect(out).toContain('aria-label="Down one, Key shift"');
    expect(out).toContain('aria-label="Up one, Key shift"');
    expect(out).toMatch(/aria-live="polite"[^>]*>[^<]*Em, up 2 semitones/);
    expect(out).toContain(">+2<");
  });

  it("disables the button at each limit", () => {
    const low = html(h(Stepper, { ...base, value: -12, onChange: () => {} }));
    expect(low).toMatch(/<button[^>]*aria-label="Down one, Key shift"[^>]*disabled=""/);
    expect(low).not.toMatch(/<button[^>]*aria-label="Up one, Key shift"[^>]*disabled=""/);
    expect(low).toContain("data-at-limit");
    const high = html(h(Stepper, { ...base, value: 12, onChange: () => {} }));
    expect(high).toMatch(/<button[^>]*aria-label="Up one, Key shift"[^>]*disabled=""/);
  });

  it("is wholly disabled without a handler", () => {
    const out = html(h(Stepper, base));
    expect(out.match(/disabled=""/g)?.length).toBe(2);
  });
});

describe("Transport", () => {
  const full = {
    title: "Dusty soul chops",
    tempo: { bpm: 90, baseBpm: 90, onChange: () => {} },
    keyShift: { semitones: 0, baseKey: { root: 2, mode: "minor" as const }, onChange: () => {} },
    loop: { on: true, onChange: () => {} },
    volume: { value: 0.8, muted: false, onChange: () => {}, onMuteChange: () => {} },
  };

  it("shows tempo, key, loop and volume under engraved labels", () => {
    const out = html(h(Transport, full));
    expect(out).toContain('aria-label="Transport for Dusty soul chops"');
    for (const label of [">Tempo<", ">Key<", ">Loop<", ">Volume<"]) expect(out).toContain(label);
    expect(out).toContain('aria-label="Tempo"');
    expect(out).toMatch(/data-tempo-readout[^>]*>90</);
    expect(out).toMatch(/data-key-readout[^>]*>Dm</);
    expect(out).toMatch(/aria-label="Loop"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Loop"/);
    expect(out).toContain('aria-label="Volume"');
  });

  it("shows the changed tempo and key, and offers a reset only when something changed", () => {
    expect(html(h(Transport, full))).not.toContain("Reset tempo and key");
    const out = html(h(Transport, { ...full, tempo: { ...full.tempo, bpm: 100 }, keyShift: { ...full.keyShift, semitones: -2 } }));
    expect(out).toMatch(/data-tempo-readout[^>]*>100</);
    expect(out).toMatch(/data-key-readout[^>]*>Cm</);
    expect(out).toContain("Reset tempo and key");
    expect(out).toContain("−2");
  });

  it("disables each control a type lacks", () => {
    const out = html(h(Transport, { title: "Kick", volume: full.volume }));
    expect(out).toMatch(/data-section="tempo"[^>]*data-disabled/);
    expect(out).toMatch(/data-section="key"[^>]*data-disabled/);
    expect(out).toMatch(/data-section="loop"[^>]*data-disabled/);
    expect(out).not.toMatch(/data-section="volume"[^>]*data-disabled/);
  });

  it("names an unknown key plainly", () => {
    const out = html(h(Transport, { ...full, keyShift: { ...full.keyShift, baseKey: null, semitones: 1 } }));
    expect(out).toMatch(/data-key-readout[^>]*>\+1</);
  });
});
