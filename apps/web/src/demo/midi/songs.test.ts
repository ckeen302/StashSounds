import { describe, expect, test } from "vitest";
import { parseChord, SONG_CHORDS, songKey, songNotes, voice } from "./songs";

describe("song chords", () => {
  test("reads the chord symbols charts use", () => {
    expect(parseChord("C#m7")).toEqual({ root: 1, tones: [0, 3, 7, 10], bass: 1 });
    expect(parseChord("Bbmaj7/D")).toEqual({ root: 10, tones: [0, 4, 7, 11], bass: 2 });
    expect(parseChord("F#m7b5")?.tones).toEqual([0, 3, 6, 10]);
    for (const s of ["Esus4", "G", "Am9", "Ebadd9", "D7(b9)", "C#m11", "Bb13", "Fm6", "Gdim7", "Abaug", "E5", "Dsus2", "A7#9"]) expect(parseChord(s), s).not.toBeNull();
    expect(parseChord("H7")).toBeNull();
  });

  test("voices chords in the middle register, moving little", () => {
    const v = voice(["C", "Am", "F", "G"].map((s) => parseChord(s)!));
    for (const c of v) {
      expect(Math.min(...c.upper)).toBeGreaterThanOrEqual(52);
      expect(Math.max(...c.upper)).toBeLessThanOrEqual(79);
      expect(c.bass).toBeGreaterThanOrEqual(36);
      expect(c.bass).toBeLessThan(48);
    }
  });

  test("every researched song turns into notes at its key and tempo", () => {
    const unread = SONG_CHORDS.flatMap((s) => s.chords.map(([c]) => c).filter((c) => !parseChord(c)).map((c) => `${s.song}: ${c}`));
    expect(unread).toEqual([]);
    for (const s of SONG_CHORDS) {
      const n = songNotes(s);
      expect(n, `${s.song}: ${s.chords.map((c) => c[0]).join(" ")}`).not.toBeNull();
      expect(n!.bpm).toBe(s.bpm);
      expect(n!.bars).toBeGreaterThanOrEqual(4);
      expect(songKey(s), `${s.song}: ${s.key}`).not.toBeNull();
      expect(s.chordSource.url).toMatch(/^https:\/\//);
    }
  });
});
