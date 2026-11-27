import { describe, expect, it } from "vitest";
import { ALWAYS, relaxations, wordsThatHit } from "./relax";

describe("what to try when nothing matches", () => {
  it("leaves one word out at a time, the last word first", () => {
    expect(relaxations("dark piano 999").slice(0, 3)).toEqual(["dark piano", "dark 999", "piano 999"]);
  });

  it("falls back to searches that always find something", () => {
    expect(relaxations("zzzz")).toEqual(ALWAYS);
    expect(relaxations("drill")).not.toContain("drill");
  });

  it("never offers more than asked", () => {
    expect(relaxations("a b c d e f", 3)).toHaveLength(3);
  });

  it("keeps the words of a text search that find something alone", () => {
    const has = (w: string) => ["kick", "trap"].includes(w);
    expect(wordsThatHit("Trap kick zzz", has)).toEqual(["trap", "kick"]);
    expect(wordsThatHit("kick", has)).toEqual([]);
    expect(wordsThatHit("kick kick zzz", has)).toEqual(["kick"]);
  });
});
