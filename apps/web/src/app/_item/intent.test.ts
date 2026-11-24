import { describe, expect, it } from "vitest";
import { INTENT_KEY, INTENT_TTL_MS, rememberIntent, takeIntent } from "./intent";

const ITEM = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } as unknown as Storage;

describe("the sign-in intent marker", () => {
  it("acts only on the marker this page set, for this item and this intent, once", () => {
    const s = memory();
    rememberIntent(s, { intent: "download", itemId: ITEM }, 1000);
    expect(takeIntent(s, "download", ITEM, 2000)).toBe("download");
    expect(s.getItem(INTENT_KEY)).toBeNull();
    expect(takeIntent(s, "download", ITEM, 2000)).toBeNull();
  });

  it("does nothing for a bare link: no marker, another item, another intent, or a stale one", () => {
    expect(takeIntent(memory(), "download", ITEM, 0)).toBeNull();
    for (const [intent, item, at] of [["download", OTHER, 0], ["like", ITEM, 0], ["download", ITEM, INTENT_TTL_MS + 1]] as const) {
      const s = memory();
      rememberIntent(s, { intent: "download", itemId: ITEM }, 0);
      expect(takeIntent(s, intent, item, at)).toBeNull();
      // A link that does not match still clears the marker, so it cannot fire later.
      expect(s.getItem(INTENT_KEY)).toBeNull();
    }
  });

  it("ignores an unknown intent, a corrupt marker, and storage that throws", () => {
    const s = memory();
    s.setItem(INTENT_KEY, "{not json");
    expect(takeIntent(s, "download", ITEM, 0)).toBeNull();
    expect(takeIntent(memory(), "delete", ITEM, 0)).toBeNull();
    expect(() => rememberIntent(broken, { intent: "like", itemId: ITEM })).not.toThrow();
    expect(takeIntent(broken, "like", ITEM)).toBeNull();
    expect(takeIntent(null, "like", ITEM)).toBeNull();
  });
});
