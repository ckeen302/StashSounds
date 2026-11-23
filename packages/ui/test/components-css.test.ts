import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { motion } from "../src/tokens.ts";

/**
 * components.css is outside the lint rules (they read TypeScript), so this holds it to the same
 * contract: colors only through theme variables, durations only from the motion tokens.
 */
const css = readFileSync(join(import.meta.dirname, "../src/components.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The loading ring's turn. Not a motion token yet: requested in docs/requests/131-ring-duration-token.md. */
const RING_TURN_MS = 800;

describe("components.css", () => {
  it("has no raw colors", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(/);
  });

  it("names colors only through theme variables", () => {
    const vars = [...css.matchAll(/var\(--([a-z-]+)/g)].map((m) => m[1]!);
    for (const v of vars) expect(v).toMatch(/^(color-|ease-out$|spacing$|progress$|playhead$|pointer$)/);
  });

  it("uses only motion token durations", () => {
    const allowed = new Set<number>([...(Object.values(motion).filter((v) => typeof v === "number") as number[]), RING_TURN_MS]);
    const used = [...css.matchAll(/(\d+)ms\b/g)].map((m) => Number(m[1]));
    expect(used.length).toBeGreaterThan(0);
    for (const ms of used) expect(allowed).toContain(ms);
  });

  it("stops the loading ring under reduced motion", () => {
    expect(css).toMatch(/@utility animate-ring\s*{[^}]*@media \(prefers-reduced-motion: reduce\)\s*{\s*animation: none;/);
  });
});
