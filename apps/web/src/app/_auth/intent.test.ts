import { describe, expect, it } from "vitest";
import { safeNextPath } from "../../server/auth/next-path";
import { INTENT_PARAM, encodeIntent, parseIntent, pathWithIntent, pathWithoutIntent } from "./intent";

describe("intent", () => {
  it("round-trips each kind", () => {
    for (const kind of ["like", "follow", "download"] as const) {
      const intent = { kind, target: "k3j9x0a2b1" };
      expect(parseIntent(encodeIntent(intent))).toEqual(intent);
    }
    expect(parseIntent("follow:kilo_beats")).toEqual({ kind: "follow", target: "kilo_beats" });
  });

  it("refuses anything that is not a known kind and a plain id or handle", () => {
    for (const raw of [null, "", "like", "like:", ":abc", "delete:abc", "like:ABC", "like:a/b", "like:a:b", "like:../x", `like:${"a".repeat(65)}`, "like:a b"]) {
      expect(parseIntent(raw)).toBeNull();
    }
  });

  it("adds do to the current path and keeps its other parameters", () => {
    const intent = { kind: "like", target: "k3j9x0a2b1" } as const;
    expect(pathWithIntent("/dev/player", "", intent)).toBe("/dev/player?do=like%3Ak3j9x0a2b1");
    expect(pathWithIntent("/search", "?q=808&type=loop", intent)).toBe("/search?q=808&type=loop&do=like%3Ak3j9x0a2b1");
    // A second press replaces the first rather than stacking.
    expect(pathWithIntent("/search", "?do=follow%3Anova", intent)).toBe("/search?do=like%3Ak3j9x0a2b1");
  });

  it("survives safeNextPath, so the callback sends the user back with it", () => {
    const next = pathWithIntent("/browse/loops", "?bpm=90", { kind: "download", target: "k3j9x0a2b1" });
    expect(safeNextPath(next)).toBe(next);
  });

  it("strips do once the action has run", () => {
    expect(pathWithoutIntent("/dev/player", "?do=like%3Ak3j9x0a2b1")).toBe("/dev/player");
    expect(pathWithoutIntent("/search", "?q=808&do=like%3Ak3j9x0a2b1")).toBe("/search?q=808");
    expect(INTENT_PARAM).toBe("do");
  });
});
