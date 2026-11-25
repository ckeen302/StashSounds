import { describe, expect, it } from "vitest";
import { likeness, match, parseQuery, profile, withoutToken } from "./smart-search";

const loop = (over: Partial<Parameters<typeof profile>[0]> = {}) =>
  profile({ id: "a", kind: "loop", title: "Dark trap piano", bpm: 140, key: { root: 0, mode: "minor" }, words: ["Dark trap piano", "piano", "dark", "trap", "A falling C minor piano line"], publishedAt: "2026-11-24T00:00:00Z", ...over });

describe("parseQuery", () => {
  it("reads tempo, sound, mood and a producer's style", () => {
    const q = parseQuery("dark piano 140 like Metro");
    expect(q.bpm).toEqual({ min: 137, max: 143, exact: 140 });
    expect(q.sounds).toEqual(["Piano"]);
    expect(q.moods).toEqual(["Dark"]);
    expect(q.styles.map((s) => s.name)).toEqual(["Metro Boomin"]);
    expect(q.words).toEqual([]);
  });
  it("reads keys, ranges and genre phrases", () => {
    expect(parseQuery("f#m bells").key).toEqual({ root: 6, mode: "minor" });
    expect(parseQuery("Bb minor").key).toEqual({ root: 10, mode: "minor" });
    expect(parseQuery("c major").key).toEqual({ root: 0, mode: "major" });
    expect(parseQuery("uk drill 140-145").bpm).toEqual({ min: 140, max: 145, exact: null });
    expect(parseQuery("uk drill").genres).toEqual(["Drill"]);
    expect(parseQuery("808 melo type beat").styles.map((s) => s.name)).toEqual(["808Melo"]);
    expect(parseQuery("808 slides").sounds).toEqual(["808"]);
    expect(parseQuery("ambient pad").key).toBeNull();
  });
  it("drops a chip's words from the query", () => {
    const q = parseQuery("dark piano 140 like metro");
    const style = q.tokens.find((t) => t.kind === "style")!;
    expect(withoutToken("dark piano 140 like metro", style)).toBe("dark piano 140");
  });
});

describe("match", () => {
  it("narrows on tempo, key, genre and sound and says why", () => {
    const m = match(loop(), parseQuery("dark piano 140 like metro"));
    expect(m).not.toBeNull();
    expect(m!.why).toEqual(expect.arrayContaining(["140 BPM", "Piano", "Dark", "Metro Boomin style"]));
    expect(match(loop(), parseQuery("bells"))).toBeNull();
    expect(match(loop(), parseQuery("drill"))).toBeNull();
    expect(match(loop({ bpm: 70 }), parseQuery("140"))!.why[0]).toContain("half or double");
    expect(match(loop(), parseQuery("d minor"))).toBeNull();
    expect(match(loop(), parseQuery("eb major"))!.why[0]).toContain("mixes with");
  });
  it("ranks a song by the named producer first", () => {
    const song = profile({ id: "s", kind: "midi", title: "Mask Off", bpm: 150, key: null, words: ["Mask Off", "Future"], people: ["Future", "Metro Boomin"], publishedAt: "2026-11-01T00:00:00Z" });
    expect(match(song, parseQuery("like metro"))!.why).toContain("By Metro Boomin");
  });
  it("needs a plain word to match when there is nothing else", () => {
    expect(match(loop(), parseQuery("falling"))).not.toBeNull();
    expect(match(loop(), parseQuery("zebra"))).toBeNull();
  });
});

describe("likeness", () => {
  it("prefers the same genre, key and tempo", () => {
    const near = likeness(loop(), loop({ id: "b", title: "Trap bells", words: ["trap", "bells", "dark"] }));
    const far = likeness(loop(), loop({ id: "c", title: "Soul keys", bpm: 90, key: { root: 2, mode: "minor" }, words: ["soul", "keys"] }));
    expect(near.score).toBeGreaterThan(far.score);
  });
});

describe("artists and typos", () => {
  it("reads an artist as a style, so their songs rank first and loops in that lane follow", () => {
    expect(parseQuery("carti type beat").styles.map((s) => s.name)).toEqual(["Playboi Carti"]);
    expect(parseQuery("the weeknd").styles.map((s) => s.name)).toEqual(["The Weeknd"]);
    const song = profile({ id: "s", kind: "midi", title: "Long Time", bpm: 140, key: null, words: ["Long Time", "Playboi Carti"], people: ["Playboi Carti", "Pi'erre Bourne"], publishedAt: "2026-11-01T00:00:00Z" });
    expect(match(song, parseQuery("carti"))!.why).toContain("By Playboi Carti");
    expect(match(loop({ words: ["rage", "synth", "lead", "hard"] }), parseQuery("carti"))!.why).toContain("Playboi Carti style");
  });
  it("forgives a typo in a long name word and keeps the typed word for the chip", () => {
    const q = parseQuery("metro boomim");
    expect(q.styles.map((s) => s.name)).toEqual(["Metro Boomin"]);
    expect(q.words).toEqual([]);
    expect(parseQuery("trvis scott").styles.map((s) => s.name)).toEqual(["Travis Scott"]);
    const t = parseQuery("dark trvis scott").tokens.find((x) => x.kind === "style")!;
    expect(withoutToken("dark trvis scott", t)).toBe("dark");
  });
  it("reads hi-hat spellings and keys spelled out", () => {
    for (const q of ["hihat", "hi hat", "hi-hats", "hat rolls"]) {
      expect(parseQuery(q).sounds).toEqual(["Drums"]);
      expect(parseQuery(q).words).toEqual([]);
    }
    expect(parseQuery("c sharp minor").key).toEqual({ root: 1, mode: "minor" });
    expect(parseQuery("140bpm").bpm?.exact).toBe(140);
  });
});

describe("plain words", () => {
  it("finds a plural of a word in the text, and an era is not a tempo", async () => {
    const { termHit, terms } = await import("./text-match");
    expect(termHit(terms("Hard 808 kit"), "808s")).toBeGreaterThan(0);
    expect(termHit(terms("Hi-hat"), "hats")).toBeGreaterThan(0);
    expect(termHit(terms("Hi-hat"), "hihat")).toBeGreaterThan(0);
    expect(termHit(terms("Pluck lead"), "plus")).toBe(0);
    expect(parseQuery("90s boom bap").bpm).toBeNull();
    expect(parseQuery("90s boom bap").genres).toEqual(["Boom bap"]);
    expect(parseQuery("140s").bpm).toEqual({ min: 140, max: 149, exact: null });
  });
});
