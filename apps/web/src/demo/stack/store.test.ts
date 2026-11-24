import { describe, expect, it } from "vitest";
import { midiItems } from "../midi/catalog";
import { keyName, keyShift, resolveStack, STARTERS, type StackState } from "./store";

const items = midiItems();
const byPublic = (id: string) => items.find((m) => m.publicId === id)!;
const stackOf = (ids: string[], extra: Partial<StackState> = {}): StackState => ({
  layers: ids.map((id, i) => ({ uid: `u${i}`, itemId: byPublic(id).id, sound: byPublic(id).sound, volume: 0.8, muted: false, solo: false })),
  bpm: null,
  key: null,
  matchKeys: true,
  ...extra,
});

describe("keyShift", () => {
  it("moves the root the shortest way, -6 to +5", () => {
    expect(keyShift({ root: 9, mode: "minor" }, { root: 0, mode: "minor" })).toBe(3); // Am to Cm
    expect(keyShift({ root: 0, mode: "minor" }, { root: 9, mode: "minor" })).toBe(-3);
    expect(keyShift({ root: 0, mode: "major" }, { root: 6, mode: "major" })).toBe(-6);
    expect(keyShift({ root: 0, mode: "major" }, { root: 5, mode: "major" })).toBe(5);
    expect(keyShift({ root: 4, mode: "minor" }, { root: 4, mode: "minor" })).toBe(0);
  });
  it("uses the relative key across modes", () => {
    // F#m into Bb major: the relative minor is Gm, so up one.
    expect(keyShift({ root: 6, mode: "minor" }, { root: 10, mode: "major" })).toBe(1);
    // Bb major into Gm: already the relative major.
    expect(keyShift({ root: 10, mode: "major" }, { root: 7, mode: "minor" })).toBe(0);
  });
  it("is zero without a key", () => {
    expect(keyShift(null, { root: 0, mode: "minor" })).toBe(0);
    expect(keyShift({ root: 0, mode: "minor" }, null)).toBe(0);
  });
});

describe("resolveStack", () => {
  it("follows the first layer's tempo and the first melodic layer's key", () => {
    const r = resolveStack(stackOf(["demomidi10", "demomidi07", "demomidi02"]), items);
    expect(r.bpm).toBe(140);
    expect(r.key).toEqual({ root: 10, mode: "major" });
    const [drums, chords, bell] = r.layers;
    expect(drums!.transpose).toBe(0);
    expect(drums!.readout).toBe("Drums: no key");
    expect(chords!.transpose).toBe(0);
    expect(bell!.transpose).toBe(1);
    expect(bell!.readout).toBe("+1 to match G minor");
    expect(r.lengthBeats).toBe(32); // the plugg chords are eight bars
  });
  it("honours tempo, key and match-keys overrides", () => {
    const r = resolveStack(stackOf(["demomidi04"], { bpm: 120, key: { root: 0, mode: "minor" } }), items);
    expect(r.bpm).toBe(120);
    expect(r.layers[0]!.readout).toBe("+3 to match C minor");
    const off = resolveStack(stackOf(["demomidi04"], { matchKeys: false, key: { root: 0, mode: "minor" } }), items);
    expect(off.layers[0]!.transpose).toBe(0);
    expect(off.layers[0]!.readout).toBe("In A minor");
  });
  it("solo silences the others; mute silences one", () => {
    const s = stackOf(["demomidi07", "demomidi02", "demomidi10"]);
    s.layers[1]!.solo = true;
    expect(resolveStack(s, items).layers.map((l) => l.audible)).toEqual([false, true, false]);
    s.layers[1]!.solo = false;
    s.layers[2]!.muted = true;
    expect(resolveStack(s, items).layers.map((l) => l.audible)).toEqual([true, true, false]);
  });
  it("names keys for people", () => {
    expect(keyName({ root: 10, mode: "major" })).toBe("B flat major");
    expect(keyName({ root: 1, mode: "minor" })).toBe("C sharp minor");
  });
});

describe("starters", () => {
  it("every starter resolves to real catalog items", () => {
    for (const s of STARTERS) for (const id of s.items) expect(byPublic(id), `${s.id}: ${id}`).toBeTruthy();
  });
});
