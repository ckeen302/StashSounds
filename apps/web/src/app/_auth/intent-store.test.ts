import { describe, expect, it } from "vitest";
import { INTENT_KEY, INTENT_TTL_MS, claimIntent, newNonce, rememberIntent } from "./intent-store";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};
const like = { kind: "like", target: "k3j9x0a2b1" };

describe("the remembered intent", () => {
  it("runs only for the nonce this browser stored, and only once", () => {
    const s = memory();
    const pending = rememberIntent(s, like, 1000);
    expect(pending).toMatchObject(like);
    expect(pending.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(claimIntent(s, pending, 2000)).toEqual(like);
    expect(s.m.has(INTENT_KEY)).toBe(false);
    expect(claimIntent(s, pending, 2000)).toBeNull();
  });

  it("refuses a link with no record behind it: a forged or someone else's nonce", () => {
    expect(claimIntent(memory(), { ...like, nonce: newNonce() }, 0)).toBeNull();
    const s = memory();
    rememberIntent(s, like, 0);
    expect(claimIntent(s, { ...like, nonce: newNonce() }, 1)).toBeNull();
    // A forged link does not wipe the real pending action.
    expect(s.m.has(INTENT_KEY)).toBe(true);
  });

  it("refuses another kind or target under the right nonce", () => {
    const s = memory();
    const pending = rememberIntent(s, like, 0);
    expect(claimIntent(s, { ...pending, kind: "follow" }, 1)).toBeNull();
    expect(claimIntent(s, { ...pending, target: "attacker" }, 1)).toBeNull();
    expect(claimIntent(s, pending, 1)).toEqual(like);
  });

  it("expires after fifteen minutes", () => {
    const s = memory();
    const pending = rememberIntent(s, like, 0);
    expect(INTENT_TTL_MS).toBe(15 * 60 * 1000);
    expect(claimIntent(s, pending, INTENT_TTL_MS + 1)).toBeNull();
    expect(s.m.has(INTENT_KEY)).toBe(false);
  });

  it("ignores a malformed record and storage that throws", () => {
    const s = memory();
    s.setItem(INTENT_KEY, "{not json");
    expect(claimIntent(s, { ...like, nonce: newNonce() }, 0)).toBeNull();
    expect(() => rememberIntent(broken, like, 0)).not.toThrow();
    expect(claimIntent(broken, { ...like, nonce: newNonce() }, 0)).toBeNull();
    expect(claimIntent(null, { ...like, nonce: newNonce() }, 0)).toBeNull();
  });

  it("makes a fresh nonce each time", () => {
    expect(newNonce()).not.toBe(newNonce());
  });
});
