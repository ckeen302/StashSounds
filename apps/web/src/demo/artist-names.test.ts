import { describe, expect, it } from "vitest";
import { canonArtist } from "./artist-names";
import { SAMPLE_SONGS, sameSong } from "./samples/data";
import { PRESETS } from "./presets/data";

describe("canonArtist", () => {
  it("files every spelling of an artist under one", () => {
    expect(canonArtist("JAY Z")).toBe("Jay-Z");
    expect(canonArtist("ASAP Rocky")).toBe("A$AP Rocky");
    expect(canonArtist("Outkast")).toBe("OutKast");
    expect(canonArtist("Run DMC")).toBe("Run-DMC");
    expect(canonArtist("Ty Dolla Sign")).toBe("Ty Dolla $ign");
  });
  it("keeps the joins of a credit and maps each name in it", () => {
    expect(canonArtist("Kanye West feat. JAY Z & Outkast")).toBe("Kanye West feat. Jay-Z & OutKast");
    expect(canonArtist("Drake")).toBe("Drake");
  });
  it("leaves acts that only look alike apart", () => {
    expect(canonArtist("Prodigy")).toBe("Prodigy");
    expect(canonArtist("Dream")).toBe("Dream");
  });
});

describe("the catalog after the clean-up", () => {
  it("has one spelling per artist across Samples and Presets", () => {
    const seen = [...SAMPLE_SONGS.map((s) => s.artist), ...PRESETS.map((p) => p.artist)];
    for (const a of seen) expect(canonArtist(a)).toBe(a);
  });
  it("merges one song credited two ways", () => {
    const philly = SAMPLE_SONGS.filter((s) => sameSong(s.song, s.artist) === sameSong("Philly", "Playboi Carti"));
    expect(philly).toHaveLength(1);
  });
  it("has no song twice on the Samples tab", () => {
    const keys = SAMPLE_SONGS.map((s) => sameSong(s.song, s.artist));
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });
});
