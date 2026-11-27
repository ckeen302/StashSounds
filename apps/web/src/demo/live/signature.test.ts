import { describe, expect, it } from "vitest";
import { cleanMessage, defaultSignature, parseSignature, SIG_COLORS, SIG_MAX, sigVar } from "./signature";

describe("producer signatures", () => {
  it("give every handle the same colour and line every time", () => {
    expect(defaultSignature("stash")).toEqual(defaultSignature("stash"));
    expect(defaultSignature("Stash")).toEqual(defaultSignature("stash"));
  });

  it("spread handles over the colours", () => {
    const seen = new Set(Array.from({ length: 64 }, (_, i) => defaultSignature(`producer${i}`).color));
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it("keep a typed line to what the screen can show", () => {
    expect(cleanMessage("  stay   dusty ✨ ")).toBe("STAY DUSTY ");
    expect(cleanMessage("<script>")).toBe("SCRIPT");
    expect(cleanMessage("x".repeat(60))).toHaveLength(SIG_MAX);
  });

  it("read back only a stored signature that is one", () => {
    expect(parseSignature(JSON.stringify({ color: "pink", message: "late night" }))).toEqual({ color: "pink", message: "LATE NIGHT" });
    expect(parseSignature(JSON.stringify({ color: "plaid", message: "x" }))).toBeNull();
    expect(parseSignature("{not json")).toBeNull();
    expect(parseSignature(null)).toBeNull();
  });

  it("paint with a token, never a raw colour", () => {
    for (const c of SIG_COLORS) expect(sigVar(c.id)).toBe(`var(--sp-sig-${c.id})`);
  });
});
