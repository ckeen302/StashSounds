import { describe, expect, it } from "vitest";
import { loopFrames, paddedLoop } from "../src/loop-layout.ts";
import type { Playable } from "../src/types.ts";
import { FakeBuffer } from "./fake-audio.ts";

type Loop = Extract<Playable, { kind: "loop" }>;
const loop = (loopSamples: number, sampleRate = 44100): Loop => ({ kind: "loop", id: "l", previewUrl: "https://p.example.com/l.mp3", loopSamples, sampleRate });

describe("loopFrames", () => {
  it("is loopSamples when the buffer is at the item's sample rate, ignoring MP3 padding", () => {
    expect(loopFrames(loop(302400), new FakeBuffer(303552, 44100))).toBe(302400);
  });
  it("converts to the context's rate when the browser resampled the preview", () => {
    expect(loopFrames(loop(88200), new FakeBuffer(100800, 48000))).toBe(96000);
    // 302400 at 44.1 kHz is 329142.86 frames at 48 kHz: rounded, then capped at what was decoded.
    expect(loopFrames(loop(302400), new FakeBuffer(329142, 48000))).toBe(329142);
    expect(loopFrames(loop(302400), new FakeBuffer(330000, 48000))).toBe(329143);
  });
  it("never exceeds the decoded buffer and is at least one frame", () => {
    expect(loopFrames(loop(100000), new FakeBuffer(50000, 44100))).toBe(50000);
    expect(loopFrames(loop(1), new FakeBuffer(10, 96000))).toBe(2);
    expect(loopFrames(loop(1, 192000), new FakeBuffer(10, 22050))).toBe(1);
  });
});

describe("paddedLoop", () => {
  const ch = (n: number, base = 0) => Float32Array.from({ length: n }, (_, i) => base + i);

  it("lays out [loop tail | loop | loop head] so the stretch window never reads silence", () => {
    const [out] = paddedLoop([ch(10)], 8, 3);
    // loop is samples 0..7 (the two after it are MP3 padding and must not appear)
    expect(Array.from(out!)).toEqual([5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2]);
  });
  it("wraps more than once when the pad is longer than the loop", () => {
    const [out] = paddedLoop([ch(3)], 3, 7);
    expect(Array.from(out!)).toEqual([2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  });
  it("keeps every channel and copies, so the arrays can be transferred", () => {
    const input = [ch(6), ch(6, 100)];
    const out = paddedLoop(input, 6, 2);
    expect(out).toHaveLength(2);
    expect(Array.from(out[1]!)).toEqual([104, 105, 100, 101, 102, 103, 104, 105, 100, 101]);
    for (const o of out) for (const i of input) expect(o.buffer).not.toBe(i.buffer);
  });
});
