import { describe, expect, it } from "vitest";
import { loopPicks, newLoops, newSongs, songPicks, type FeedLoop, type FeedSong, type Signals } from "./feed";

const loop = (id: string, o: Partial<FeedLoop> = {}): FeedLoop => ({ id, title: `Loop ${id}`, ownerId: "a", bpm: 140, tags: [], genre: "trap", style: null, publishedAt: "2026-01-01", ...o });
const song = (slug: string, o: Partial<FeedSong> = {}): FeedSong => ({ slug, song: slug, artist: "Someone", producers: [], year: 2020, ...o });
const none: Signals = { liked: new Set(), followed: new Set(), savedSongs: new Set() };

describe("picks from what you liked", () => {
  it("shows nothing until something is liked, saved or followed", () => {
    expect(loopPicks([loop("1"), loop("2")], none)).toEqual([]);
    expect(songPicks([song("x")], none, [])).toEqual([]);
  });

  it("picks loops like a liked one and says which", () => {
    const loops = [
      loop("liked", { style: "Metro Boomin", tags: ["dark"] }),
      loop("same-style", { ownerId: "b", style: "Metro Boomin", tags: ["dark"] }),
      loop("unrelated", { ownerId: "c", genre: "house", bpm: 124 }),
    ];
    const picks = loopPicks(loops, { ...none, liked: new Set(["liked"]) });
    expect(picks.map((p) => p.loop.id)).toEqual(["same-style"]);
    expect(picks[0]!.because).toBe("Because you liked Loop liked");
  });

  it("never picks a liked loop and keeps one producer to two", () => {
    const loops = [loop("liked"), ...["1", "2", "3", "4"].map((i) => loop(i)), loop("5", { ownerId: "b" })];
    const picks = loopPicks(loops, { ...none, liked: new Set(["liked"]) });
    expect(picks.some((p) => p.loop.id === "liked")).toBe(false);
    expect(picks.filter((p) => p.loop.ownerId === "a")).toHaveLength(2);
  });

  it("brings in people you follow", () => {
    const picks = loopPicks([loop("1", { ownerId: "f" })], { ...none, followed: new Set(["f"]) });
    expect(picks[0]?.because).toBe("From someone you follow");
  });

  it("picks songs by the producers of saved songs and of liked styles", () => {
    const songs = [song("saved", { producers: ["Wheezy"] }), song("next", { producers: ["Wheezy"], year: 2024 }), song("style", { producers: ["Metro Boomin"] }), song("other", { artist: "Nobody" })];
    const picks = songPicks(songs, { ...none, savedSongs: new Set(["saved"]) }, ["Metro Boomin"]);
    expect(picks.map((p) => p.song.slug)).toEqual(["next", "style"]);
    expect(picks[0]!.because).toBe("Produced by Wheezy, like saved");
  });
});

describe("new additions", () => {
  it("lists the newest loops, two per uploader at most", () => {
    const loops = [loop("old", { publishedAt: "2025-01-01", ownerId: "z" }), ...["1", "2", "3"].map((i) => loop(i, { publishedAt: `2026-02-0${i}` }))];
    expect(newLoops(loops).map((l) => l.id)).toEqual(["3", "2", "old"]);
  });

  it("lists the newest songs first", () => {
    expect(newSongs([song("a", { year: 2019 }), song("b", { year: 2026 }), song("c", { year: null })]).map((s) => s.slug)).toEqual(["b", "a"]);
  });
});
