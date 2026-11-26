import { describe, expect, it } from "vitest";
import type { SampleSong } from "../samples/data";
import { digsOf } from "./digs";

const use = (artist: string, title = "x") => ({ title, artist, year: null, genre: "Soul", type: "sample" as const, page: null, video: null });
const song = (key: string, artist: string, samples: ReturnType<typeof use>[]): SampleSong => ({ song: key, artist, year: null, album: null, producers: [], samples, sources: [], video: null, slug: key, key });

describe("the artists a producer samples", () => {
  it("lists artists sampled on two or more of their songs, most often first, once per song", () => {
    const songs = [
      song("a", "Rapper", [use("Isaac Hayes", "one"), use("Isaac Hayes", "two"), use("Curtis Mayfield")]),
      song("b", "Rapper", [use("Isaac Hayes"), use("Curtis Mayfield feat. Someone")]),
      song("c", "Rapper", [use("Isaac Hayes"), use("Al Green")]),
      song("d", "Rapper", [use("Rapper"), use("Rapper")]),
      song("e", "Rapper", [use("Rapper")]),
    ];
    expect(digsOf(songs)).toEqual(["Isaac Hayes", "Curtis Mayfield"]);
    expect(digsOf(songs, "Isaac Hayes")).toEqual(["Curtis Mayfield"]);
  });

  it("finds the records Kanye West keeps going back to", async () => {
    const { SAMPLE_SONGS } = await import("../samples/data");
    const { producerNamed } = await import("./data");
    const p = producerNamed("Kanye West")!;
    const digs = digsOf(p.samples.map((i) => SAMPLE_SONGS[i]!), p.name);
    expect(digs.length).toBeGreaterThan(2);
    expect(new Set(digs).size).toBe(digs.length);
  });
});
