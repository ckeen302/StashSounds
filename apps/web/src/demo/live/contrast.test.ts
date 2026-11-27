import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, pixelSizes, rootTokens } from "./contrast";

const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const sheets = ["sampler.css", "machine.css", "library.css", "stage.css"].map(read);
const tok = rootTokens(...sheets);
const c = (fg: string, bg: string) => contrast(tok.get(fg) ?? fg, tok.get(bg) ?? bg);

/** Text colour on the surface it sits on, as the machine draws them. */
const TEXT: [string, string][] = [
  ["--sp-ink", "--sp-panel"],
  ["--sp-ink", "--sp-key"],
  ["--sp-ink", "--sp-panel-low"],
  ["--sp-ink", "--sp-hot"],
  ["--sp-ink", "--sp-gold"],
  ["--sp-label", "--sp-panel"],
  ["--sp-label", "--sp-key"],
  ["--sp-label", "--sp-panel-low"],
  ["--color-text-muted", "--sp-panel"],
  ["--color-text-muted", "--color-surface"],
  ["--sp-hot-ink", "--sp-panel"],
  ["--sp-hot-ink", "--sp-key"],
  ["--sp-pad-text", "--sp-pad"],
  ["--sp-pad-text", "--sp-dark"],
  ["--sp-pad-sub", "--sp-pad"],
  ["--sp-pad-sub", "--sp-pad-hover"],
  ["--sp-pad-sub", "--sp-dark"],
  ["--sp-lcd-ink", "--sp-lcd"],
  ["--sp-lcd-dim", "--sp-lcd"],
  ["--sp-lcd", "--sp-lcd-ink"],
  ["--sp-ink", "--sp-card"],
  ["--sp-ink", "--sp-card-hover"],
  ["--sp-ink", "--sp-well"],
  ["--sp-label", "--sp-card"],
  ["--sp-label", "--sp-well"],
  ["--sp-card", "--sp-ink"],
  ["--color-text-muted", "--sp-card"],
  ["--color-type-loop", "--color-surface"],
  ["--color-type-oneshot", "--color-surface"],
  ["--color-type-kit", "--color-surface"],
  ["--color-type-midi", "--color-surface"],
  ["--color-type-preset", "--color-surface"],
  ...(["loop", "oneshot", "kit", "midi", "preset"].map((t) => [`--color-type-${t}`, "--sp-panel"]) as [string, string][]),
];

describe("the machine is readable", () => {
  it("reads its colour tokens from the stylesheets", () => {
    expect(tok.get("--sp-sig-hot")).toBe(tok.get("--sp-hot"));
    expect(tok.get("--sp-lcd")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(TEXT)("%s on %s meets 4.5:1", (fg, bg) => {
    expect(c(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("puts a profile's large initials in ink on every signature colour at 3:1 or more", () => {
    const sigs = [...tok.keys()].filter((k) => k.startsWith("--sp-sig-"));
    expect(sigs.length).toBe(8);
    for (const k of sigs) expect(c("--sp-ink", k)).toBeGreaterThanOrEqual(3);
  });

  it("keeps the meters' lit colours apart from an unlit light", () => {
    for (const lit of ["--sp-lcd-ink", "--sp-vu-hot", "--sp-vu-peak"]) expect(c(lit, "--sp-led-off")).toBeGreaterThanOrEqual(1.5);
  });

  it("sets no text smaller than 11px, and readable labels at 12px or more", () => {
    const sizes = sheets.flatMap(pixelSizes);
    expect(sizes.filter((s) => s.px < 11)).toEqual([]);
    const words = sizes.filter((s) => /sp-tag|sp-cover-label|readouts|lib-rack-head|sp-nosignal|sp-boot|sp-knob|sp-plate/.test(s.selector));
    expect(words.length).toBeGreaterThan(3);
    expect(words.filter((s) => s.px < 12)).toEqual([]);
  });
});
