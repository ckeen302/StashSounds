import { describe, expect, it } from "vitest";
import { SAMPLE_SONGS, sampleHref } from "../samples/data";
import { kitFor, matchKey, partsOf, songAllBySlug, songAllOf, songFromPreset, SONGS } from "./data";

describe("one page per song", () => {
  it("files every spelling of a song under one key", () => {
    expect(matchKey("XO TOUR Llif3", "Lil Uzi Vert")).toBe(matchKey("XO Tour Llif3 (Remix)", "Lil Uzi Vert feat. Someone"));
    expect(matchKey("SICKO MODE", "Travis Scott featuring Drake")).toBe(matchKey("Sicko Mode", "Travis Scott"));
  });

  it("gathers samples, presets and chords of one song on one page", () => {
    const s = songAllOf("SICKO MODE", "Travis Scott");
    expect(s).not.toBeNull();
    expect(s!.preset).not.toBeNull();
    expect(s!.sample).not.toBeNull();
    expect(s!.chords.length).toBeGreaterThan(0);
    expect(partsOf(s!)).toEqual(["samples", "presets", "chords", "drums"]);
  });

  it("gives every song its own address, and old Presets addresses land on the same song", () => {
    const slugs = new Set(SONGS.map((s) => s.slug));
    expect(slugs.size).toBe(SONGS.length);
    const s = songAllOf("SICKO MODE", "Travis Scott")!;
    expect(songAllBySlug(s.slug)).toBe(s);
    expect(songFromPreset(s.preset!.slug)).toBe(s);
    expect(s.sample!.songSlug).toBe(s.slug);
  });

  it("picks a drum kit by the song's producer, then the artist's sound, and says which", () => {
    const sicko = kitFor(songAllOf("SICKO MODE", "Travis Scott")!)!;
    expect(sicko.why).toMatch(/who produced this song/);
    const carti = SONGS.find((s) => /^Playboi Carti/.test(s.artist) && !s.producers.some((p) => /bourne|f1lthy/i.test(p)))!;
    expect(kitFor(carti)!.kit.inspiredBy).toBe("Pi'erre Bourne");
    expect(SONGS.every((s) => kitFor(s) !== null)).toBe(true);
  });
  it("sends every version of a song to its one page", () => {
    for (const x of SAMPLE_SONGS) expect(songAllBySlug(sampleHref(x).slice("/song/".length)), x.slug).not.toBeNull();
    const ride = songAllOf("Let Me Ride (Extended Club Mix)", "Dr. Dre");
    expect(ride?.song).toBe("Let Me Ride");
  });
});
