import { describe, expect, it } from "vitest";
import { drumMapper, guessDrumPart, nameSaysDrums } from "./drum-parts";
import { parseMidi } from "./parse";
import { writeMidi } from "./write";

type N = [number, number, number, number];
const hatsOnC5: N[] = Array.from({ length: 32 }, (_, i) => [i * 0.25, 0.2, 72, 100]);
const file = (notes: N[], drums = false) => ({ version: 1 as const, bpm: 140, timeSignature: [4, 4] as [number, number], bars: 2, pitchMin: 36, pitchMax: 72, drums, notes });

describe("drum MIDI", () => {
  it("reads a hi-hat line exported on channel 1 as hi-hats", () => {
    const a = parseMidi(writeMidi(file(hatsOnC5), "x"), "hat_roll_140.mid");
    expect(a.kind).toBe("drums");
    expect(a.part).toBe("hats");
    expect(a.notes.drums).toBe(true);
  });
  it("spots a hi-hat line by its notes when the name says nothing", () => {
    expect(parseMidi(writeMidi(file(hatsOnC5), "x"), "loop3.mid").part).toBe("hats");
  });
  it("plays every hi-hat note on a hi-hat, long ones open", () => {
    const map = drumMapper(hatsOnC5, "hats");
    expect(map(72, 0.2)).toBe(42);
    expect(map(72, 0.5)).toBe(46);
  });
  it("leaves melodies alone", () => {
    const mel: N[] = [[0, 1, 60, 100], [1, 1, 63, 100], [2, 1, 67, 100], [3, 1, 70, 100]];
    expect(parseMidi(writeMidi(file(mel), "x"), "dark melody 140.mid").kind).not.toBe("drums");
    expect(nameSaysDrums("trim prime chords")).toBe(false);
  });
  it("maps a sampler kit by how each note is used", () => {
    const kit: N[] = [];
    for (let b = 0; b < 2; b++) {
      kit.push([b * 4, 0.25, 60, 120], [b * 4 + 1, 0.25, 62, 110], [b * 4 + 3, 0.25, 62, 110]);
      for (let h = 0; h < 8; h++) kit.push([b * 4 + h * 0.5, 0.2, 66, 90]);
    }
    const map = drumMapper(kit, guessDrumPart("beat.mid", kit));
    expect([map(60, 0.25), map(62, 0.25), map(66, 0.2)]).toEqual([36, 38, 42]);
  });
});
