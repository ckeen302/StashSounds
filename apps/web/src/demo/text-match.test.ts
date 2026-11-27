import { describe, expect, it } from "vitest";
import { expandNicknames, fold, queryWords, respell, textMatch, vocabulary, within } from "./text-match";

describe("search spelling", () => {
  it("counts two swapped letters as one typo", () => {
    expect(within("kayne", "kanye", 1)).toBe(true);
    expect(within("fuutre", "future", 1)).toBe(true);
    expect(within("kanye", "kane", 1)).toBe(true);
    expect(within("kanye", "wayne", 1)).toBe(false);
  });

  it("forgives a swap in a short word but not a different word", () => {
    expect(textMatch([{ text: "Dark trap piano", weight: 1 }], ["tarp"])?.all).toBe(true);
    expect(textMatch([{ text: "Kid Cudi", weight: 1 }], ["ksi"])).toBeNull();
  });

  it("respells a word the catalog never uses, swaps first", () => {
    const vocab = vocabulary(["Kanye West", "Kanye West", "Big Daddy Kane", "Lil Wayne", "Dark trap piano"]);
    expect(respell(["kayne"], vocab)).toEqual({ words: ["kanye"], changed: true });
    expect(respell(["drk", "piano"], vocab).words).toEqual(["dark", "piano"]);
    expect(respell(["kanye", "140"], vocab).changed).toBe(false);
  });

  it("reads a dollar sign as an s", () => {
    expect(fold("A$AP Rocky")).toBe("asap rocky");
  });
});

describe("nicknames", () => {
  it("reads what fans call an artist as the name", () => {
    expect(queryWords("ye")).toEqual(["kanye"]);
    expect(queryWords("hov")).toEqual(["jay", "z"]);
    expect(queryWords("weezy")).toEqual(["lil", "wayne"]);
    expect(expandNicknames("la flame 140")).toBe("travis scott 140");
  });

  it("leaves words that only contain a nickname alone", () => {
    expect(queryWords("yeat")).toEqual(["yeat"]);
    expect(queryWords("hover")).toEqual(["hover"]);
  });
});
