import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WebAudioEngine } from "../src/engine.ts";
import type { Playable } from "../src/types.ts";
import { FakeContext, fakeFetch, fakeStretchLoader, flush, type FakeGain } from "./fake-audio.ts";

// The fake context runs at 48 kHz. Loop: 2 s (88200 samples at 44.1 kHz = 96000 frames at 48 kHz), BPM 140,
// decoded as 2.1 s (MP3 padding). Stretch latency 0.12 s, so a change is heard at now + 0.14 s.
const url = (id: string) => `https://p.example.com/${id}.mp3`;
const loop = (id: string): Playable => ({ kind: "loop", id, previewUrl: url(id), loopSamples: 88200, sampleRate: 44100, bpm: 140 });
const oneshot = (id: string): Playable => ({ kind: "oneshot", id, previewUrl: url(id) });
const LEAD = 0.14;
const PAD = 1; // seconds of padding either side of the loop in the stretch's buffer
const LOOP_FRAMES = 96000;

async function settle() {
  for (let i = 0; i < 10; i++) await flush();
}

function setup() {
  const net = fakeFetch({ [url("a")]: 2100, [url("b")]: 3100, [url("s")]: 500 });
  const ctx = new FakeContext();
  const stretch = fakeStretchLoader();
  /** The engine's waits on the audio clock: each one moves the fake clock on by that much. */
  const sleeps: number[] = [];
  const sleep = async (s: number) => {
    sleeps.push(s);
    ctx.advance(s);
  };
  const e = new WebAudioEngine({ createContext: () => ctx, fetch: net.fetch, loadStretch: stretch.load, sleep });
  const plainPlaying = () => ctx.playing.filter((s) => s.buffer);
  return { e, ctx, stretch, node: stretch.node, plainPlaying, sleeps };
}

describe("loop at its original tempo and key", () => {
  it("plays on a plain buffer source and never loads the stretch", async () => {
    const { e, stretch, plainPlaying } = setup();
    await e.play(loop("a"));
    await settle();
    expect(stretch.state.calls).toBe(0);
    expect(plainPlaying()).toHaveLength(1);
    expect(plainPlaying()[0]!.loopEnd).toBe(2);
  });
  it("one-shots ignore tempo and key: the stretch is for loops", async () => {
    const { e, stretch } = setup();
    await e.play(oneshot("s"));
    e.setTranspose(3);
    await settle();
    expect(stretch.state.calls).toBe(0);
  });
  it("engine source never imports the library statically", () => {
    const dir = join(import.meta.dirname, "../src");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/^\s*import[^;(]*["']signalsmith-stretch["']/m);
      expect(src, f).not.toMatch(/^\s*export[^;(]*from\s*["']signalsmith-stretch["']/m);
    }
  });
});

describe("loading the stretch", () => {
  it("loads once, the first time a loop needs it", async () => {
    const { e, stretch } = setup();
    await e.play(loop("a"));
    e.setTempo(70);
    e.setTempo(100);
    e.setTranspose(2);
    await settle();
    expect(stretch.state.calls).toBe(1);
  });
  it("gives it the loop laid out with a loop-long tail and head pad, and routes it through its own gain", async () => {
    const { e, ctx, node } = setup();
    e.setTranspose(3);
    await e.play(loop("a"));
    await settle();
    expect(node.buffers).toHaveLength(1);
    const [left, right] = node.buffers[0]!;
    const padFrames = PAD * 48000;
    expect(left!.length).toBe(padFrames + LOOP_FRAMES + padFrames);
    // FakeBuffer sample i is i on the left channel and 1e6 + i on the right.
    expect(left![padFrames]).toBe(0);
    expect(left![padFrames - 1]).toBe(LOOP_FRAMES - 1);
    expect(left![padFrames + LOOP_FRAMES]).toBe(0);
    expect(right![padFrames + 5]).toBe(1e6 + 5);
    const gain = node.connected[0]!;
    expect(ctx.gains).toContain(gain);
    expect((gain as unknown as { connected: unknown[] }).connected).toEqual([ctx.gains[0]]);
  });
  it("starts a loop on the stretch when a key or tempo change is already set", async () => {
    const { e, ctx, node, plainPlaying } = setup();
    e.setTranspose(3);
    await e.play(loop("a"));
    await settle();
    expect(plainPlaying()).toHaveLength(0);
    expect(node.lastStart).toEqual({ active: true, output: expect.closeTo(LEAD), input: PAD, rate: 1, semitones: 3, loopStart: PAD, loopEnd: PAD + 2 });
    expect(e.getState().status).toBe("playing");
    expect(e.getPositionMs()).toBe(0); // nothing heard until the start time
    ctx.advance(LEAD + 0.5);
    expect(e.getPositionMs()).toBeCloseTo(500);
  });
  it("reloads its buffers when another loop plays", async () => {
    const { e, node } = setup();
    e.setTranspose(3);
    await e.play(loop("a"));
    await settle();
    await e.play(loop("b"));
    await settle();
    expect(node.drops).toBe(2);
    expect(node.buffers).toHaveLength(1);
    expect(node.lastStart?.loopEnd).toBe(PAD + 2);
  });
});

describe("live tempo and key change without restarting", () => {
  it("hands a playing loop over to the stretch at the same position, with a crossfade", async () => {
    const { e, ctx, node } = setup();
    await e.play(loop("a"));
    ctx.advance(0.5);
    e.setTempo(70); // ratio 0.5
    expect(e.getState().tempoRatio).toBe(0.5);
    await settle();
    const T = 0.5 + LEAD;
    expect(node.lastStart).toMatchObject({ active: true, output: expect.closeTo(T), rate: 0.5, semitones: 0, loopStart: PAD, loopEnd: PAD + 2 });
    expect(node.lastStart!.input).toBeCloseTo(PAD + T); // where the plain voice is at T
    // The plain voice is not restarted: one source, faded out at T and stopped just after.
    expect(ctx.sources).toHaveLength(1);
    const plain = ctx.sources[0]!;
    expect(plain.stoppedAt).toBeCloseTo(T + 0.03);
    const plainGain = ctx.gains[1]!;
    expect(plainGain.gain.events.at(-1)).toMatchObject({ type: "target", value: 0, time: expect.closeTo(T) });
    const stretchGain = node.connected[0] as unknown as { gain: { events: { type: string; value: number; time: number }[] } };
    expect(stretchGain.gain.events.slice(-2)).toMatchObject([
      { type: "set", value: 0 },
      { type: "target", value: 1, time: expect.closeTo(T) },
    ]);
    // Position runs at the old rate until T, then at the new one.
    ctx.advance(0.1);
    expect(e.getPositionMs()).toBeCloseTo(600);
    ctx.advance(LEAD - 0.1 + 1);
    expect(e.getPositionMs()).toBeCloseTo(T * 1000 + 500);
    expect(e.getState().status).toBe("playing");
  });
  it("applies later changes to the running stretch with its exact position", async () => {
    const { e, ctx, node } = setup();
    await e.play(loop("a"));
    e.setTempo(70);
    await settle();
    ctx.advance(1); // heard from 0.14 at rate 0.5: position 0.14 + 0.43
    e.setTranspose(-2);
    await settle();
    const change = node.schedules.at(-1)!;
    expect(change.output).toBeCloseTo(1 + LEAD);
    expect(change.input).toBeCloseTo(PAD + LEAD + (1 + LEAD - LEAD) * 0.5);
    expect(change).toMatchObject({ rate: 0.5, semitones: -2 });
    // Each schedule is complete: the library drops every change at or after the current time when a
    // new one arrives, and fills missing fields from what is left.
    expect(change).toMatchObject({ active: true, loopStart: PAD, loopEnd: PAD + 2 });
    expect(ctx.sources).toHaveLength(1); // still no restart
  });
  it("a change before the stretch is heard replaces its pending start instead of cancelling it", async () => {
    const { e, ctx, node } = setup();
    await e.play(loop("a"));
    ctx.advance(0.5);
    e.setTempo(70);
    await settle();
    const start = node.lastStart!;
    ctx.advance(0.05); // the stretch starts at 0.64: still pending
    e.setTranspose(2);
    await settle();
    const change = node.schedules.at(-1)!;
    expect(change).toMatchObject({ active: true, rate: 0.5, semitones: 2, loopStart: PAD, loopEnd: PAD + 2 });
    expect(change.output).toBeCloseTo(start.output!);
    expect(change.input).toBeCloseTo(start.input!);
    ctx.advance(LEAD + 1);
    expect(e.getPositionMs()).toBeCloseTo((0.5 + LEAD) * 1000 + (0.05 + 1) * 500);
  });
  it("wraps the position on the loop length at the new rate", async () => {
    const { e, ctx } = setup();
    e.setTempo(280); // nothing current yet: ignored
    e.setTranspose(1);
    await e.play(loop("a"));
    e.setTempo(280); // ratio 2
    await settle();
    ctx.advance(LEAD + 1.5); // 3 s of loop at double speed
    expect(e.getPositionMs()).toBeCloseTo(1000);
  });
  it("going back to the original tempo before the stretch is ready cancels the handoff", async () => {
    const { e, ctx, stretch, node, plainPlaying } = setup();
    stretch.hold();
    await e.play(loop("a"));
    e.setTempo(70);
    await settle();
    e.setTempo(140);
    stretch.release();
    await settle();
    expect(node.lastStart).toBeUndefined();
    expect(plainPlaying()).toHaveLength(1);
    expect(ctx.sources).toHaveLength(1);
  });
  it("pausing while the stretch loads cancels the handoff", async () => {
    const { e, stretch, node } = setup();
    stretch.hold();
    await e.play(loop("a"));
    e.setTempo(70);
    await settle();
    e.pause();
    stretch.release();
    await settle();
    expect(node.lastStart).toBeUndefined();
    expect(e.getState().status).toBe("paused");
  });
});

describe("tempo limits", () => {
  // limits.bpm in packages/contracts: 40 to 300 BPM. The loop is 140 BPM.
  it("clamps a tempo above the maximum to 300 BPM, so the stretch never runs past its loop", async () => {
    const { e, ctx, node } = setup();
    await e.play(loop("a"));
    e.setTempo(1e6);
    await settle();
    expect(e.getState().tempoRatio).toBeCloseTo(300 / 140);
    expect(node.schedules.at(-1)!.rate).toBeCloseTo(300 / 140);
    ctx.advance(LEAD + 100);
    expect(Number.isFinite(e.getPositionMs())).toBe(true);
    expect(e.getPositionMs()).toBeGreaterThanOrEqual(0);
    expect(e.getPositionMs()).toBeLessThan(2000);
  });
  it("clamps a tempo below the minimum to 40 BPM", async () => {
    const { e } = setup();
    await e.play(loop("a"));
    e.setTempo(1e-9);
    expect(e.getState().tempoRatio).toBeCloseTo(40 / 140);
    e.setTempo(Number.MAX_VALUE);
    expect(e.getState().tempoRatio).toBeCloseTo(300 / 140);
  });
  it("ignores tempos that are not a positive finite number", async () => {
    const { e } = setup();
    await e.play(loop("a"));
    for (const bpm of [0, -10, Infinity, -Infinity, NaN]) e.setTempo(bpm);
    expect(e.getState().tempoRatio).toBe(1);
  });
});

describe("pause, resume and seek on the stretch", () => {
  async function onStretch() {
    const s = setup();
    s.e.setTranspose(3);
    await s.e.play(loop("a"));
    await settle();
    s.ctx.advance(LEAD + 0.5);
    return s;
  }
  it("pause fades the stretch out, stops it and freezes the position", async () => {
    const { e, ctx, node } = await onStretch();
    e.pause();
    const now = LEAD + 0.5;
    expect(node.schedules.at(-1)).toMatchObject({ active: false });
    expect(node.schedules.at(-1)!.output).toBeCloseTo(now + 0.03);
    const g = node.connected[0] as unknown as { gain: { events: { type: string; value: number }[] } };
    expect(g.gain.events.at(-1)).toMatchObject({ type: "target", value: 0 });
    ctx.advance(2);
    expect(e.getPositionMs()).toBeCloseTo(500);
  });
  it("resume starts the stretch again from the paused position", async () => {
    const { e, ctx, node } = await onStretch();
    e.pause();
    ctx.advance(1);
    await e.play();
    await settle();
    expect(node.lastStart!.input).toBeCloseTo(PAD + 0.5);
    expect(node.lastStart!.output).toBeCloseTo(ctx.currentTime + LEAD);
    expect(e.getState().status).toBe("playing");
  });
  it("seek restarts the stretch at the new position", async () => {
    const { e, node } = await onStretch();
    e.seek(1500);
    await settle();
    expect(node.lastStart!.input).toBeCloseTo(PAD + 1.5);
    expect(e.getPositionMs()).toBeCloseTo(1500);
  });
  /** The stretch's own gain (the node connects to it). */
  const stretchGain = (node: { connected: unknown[] }) => (node.connected[0] as FakeGain).gain;
  it("seek fades the old position out from now and the new one in from its start, with no jump", async () => {
    const { e, ctx, node } = await onStretch();
    const g = stretchGain(node);
    const t0 = ctx.currentTime;
    const before = g.at(t0);
    expect(before).toBeGreaterThan(0.99);
    e.seek(1500);
    await settle();
    const T = node.lastStart!.output!;
    expect(T).toBeCloseTo(t0 + LEAD);
    expect(g.at(t0 + 0.001), "no step at the seek").toBeGreaterThan(0.75);
    expect(g.at(t0 + 0.03)).toBeLessThan(0.01);
    expect(g.at(T - 1e-6), "silent when the new position starts").toBeLessThan(1e-3);
    expect(g.at(T + 0.001), "the new position ramps in").toBeLessThan(0.25);
    expect(g.at(T + 0.05)).toBeGreaterThan(0.99);
  });
  it("switching to another loop keeps the old one's fade and swaps buffers only once it is silent", async () => {
    const { e, ctx, node, sleeps } = await onStretch();
    e.preload(loop("b"));
    await settle();
    const dropsAt: number[] = [];
    const drop = node.dropBuffers.bind(node);
    node.dropBuffers = () => {
      dropsAt.push(ctx.currentTime);
      return drop();
    };
    const g = stretchGain(node);
    const t0 = ctx.currentTime;
    await e.play(loop("b"));
    await settle();
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "b" } });
    expect(sleeps.length).toBeGreaterThan(0);
    expect(dropsAt).toHaveLength(1);
    expect(dropsAt[0]).toBeGreaterThanOrEqual(t0 + 0.03 - 1e-9);
    expect(g.at(t0 + 0.001), "no step at the switch").toBeGreaterThan(0.75);
    expect(g.at(dropsAt[0]!), "silent when the buffers are swapped").toBeLessThan(0.01);
    const T = node.lastStart!.output!;
    expect(T).toBeGreaterThan(dropsAt[0]!);
    expect(g.at(T - 1e-6)).toBeLessThan(1e-3);
    expect(g.at(T + 0.05)).toBeGreaterThan(0.99);
  });
  it("switching to a one-shot silences the stretch", async () => {
    const { e, node } = await onStretch();
    await e.play(oneshot("s"));
    expect(node.schedules.at(-1)).toMatchObject({ active: false });
  });
});

describe("a stretch that fails to load", () => {
  it("a node made but not working (latency rejects) is disconnected, and the next change makes a new one", async () => {
    const { e, stretch, node } = setup();
    node.failLatency = true;
    await e.play(loop("a"));
    e.setTempo(70);
    await settle();
    expect(e.getState()).toMatchObject({ status: "playing", tempoRatio: 1 });
    expect(node.disconnects).toBe(1);
    node.failLatency = false;
    e.setTempo(70);
    await settle();
    expect(stretch.state.calls).toBe(2);
    expect(e.getState().tempoRatio).toBe(0.5);
    expect(node.lastStart).toBeDefined();
  });
  it("a buffer swap queued for an item that is no longer current does not run", async () => {
    const { e, stretch, node } = setup();
    stretch.hold();
    await e.play(loop("a"));
    e.setTempo(70); // a waits for the stretch
    await settle();
    await e.play(loop("b")); // b is stretched too (the tempo carries over as a ratio) and waits as well
    await settle();
    stretch.release();
    await settle();
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "b" } });
    expect(node.drops, "only b's buffers were loaded into the stretch").toBe(1);
    expect(node.buffers).toHaveLength(1);
    expect(node.buffers[0]![0]!.length).toBeGreaterThan(3 * 48000); // b: 3.1 s decoded, padded
  });
  it("keeps the loop playing at its original tempo and key, and is retried next time", async () => {
    const { e, stretch, plainPlaying } = setup();
    stretch.state.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await e.play(loop("a"));
    e.setTempo(70);
    await settle();
    expect(e.getState()).toMatchObject({ status: "playing", tempoRatio: 1, transpose: 0 });
    expect(plainPlaying()).toHaveLength(1);
    stretch.state.fail = false;
    e.setTempo(70);
    await settle();
    expect(stretch.state.calls).toBe(2);
    expect(e.getState().tempoRatio).toBe(0.5);
    warn.mockRestore();
  });
  it("falls back to the plain path when a loop was about to start on it", async () => {
    const { e, stretch, plainPlaying } = setup();
    stretch.state.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    e.setTranspose(2);
    await e.play(loop("a"));
    await settle();
    expect(e.getState()).toMatchObject({ status: "playing", transpose: 0 });
    expect(plainPlaying()).toHaveLength(1);
    warn.mockRestore();
  });
});
