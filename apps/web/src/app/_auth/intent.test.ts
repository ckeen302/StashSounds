import { describe, expect, it } from "vitest";
import { safeNextPath } from "../../server/auth/next-path";
import { INTENT_PARAM, encodeIntent, parseIntent, pathWithIntent, pathWithoutIntent } from "./intent";

const nonce = "0123456789abcdef0123456789abcdef";

describe("intent", () => {
  it("round-trips a kind, a target and the nonce that ties it to this browser", () => {
    for (const kind of ["like", "follow", "download"]) {
      const intent = { kind, target: "k3j9x0a2b1", nonce };
      expect(parseIntent(encodeIntent(intent))).toEqual(intent);
    }
    expect(parseIntent(`follow:kilo_beats:${nonce}`)).toEqual({ kind: "follow", target: "kilo_beats", nonce });
  });

  it("refuses anything without a well-formed nonce, and any path or extra value", () => {
    for (const raw of [
      null,
      "",
      "like",
      "like:k3j9x0a2b1", // a bare link: no nonce
      `like:k3j9x0a2b1:${nonce.slice(1)}`,
      `like:k3j9x0a2b1:${nonce.toUpperCase()}`,
      `like::${nonce}`,
      `:abc:${nonce}`,
      `like:ABC:${nonce}`,
      `like:a/b:${nonce}`,
      `like:../x:${nonce}`,
      `like:a b:${nonce}`,
      `like:${"a".repeat(65)}:${nonce}`,
      `like:a:b:${nonce}`,
      `Like:abc:${nonce}`,
    ]) {
      expect(parseIntent(raw)).toBeNull();
    }
  });

  it("adds do to the current path and keeps its other parameters", () => {
    const intent = { kind: "like", target: "k3j9x0a2b1", nonce };
    expect(pathWithIntent("/dev/player", "", intent)).toBe(`/dev/player?do=like%3Ak3j9x0a2b1%3A${nonce}`);
    expect(pathWithIntent("/search", "?q=808&type=loop", intent)).toBe(`/search?q=808&type=loop&do=like%3Ak3j9x0a2b1%3A${nonce}`);
    // A second press replaces the first rather than stacking.
    expect(pathWithIntent("/search", "?do=follow%3Anova", intent)).toBe(`/search?do=like%3Ak3j9x0a2b1%3A${nonce}`);
  });

  it("survives safeNextPath, so the callback sends the user back with it", () => {
    const next = pathWithIntent("/browse/loops", "?bpm=90", { kind: "download", target: "k3j9x0a2b1", nonce });
    expect(safeNextPath(next)).toBe(next);
  });

  it("strips do once the action has run", () => {
    expect(pathWithoutIntent("/dev/player", `?do=like%3Ak3j9x0a2b1%3A${nonce}`)).toBe("/dev/player");
    expect(pathWithoutIntent("/search", `?q=808&do=like%3Ak3j9x0a2b1%3A${nonce}`)).toBe("/search?q=808");
    expect(INTENT_PARAM).toBe("do");
  });
});
