import { describe, expect, it, vi } from "vitest";
import { INITIAL_STATE, WebAudioEngine } from "../src/engine.ts";
import type { Playable } from "../src/types.ts";
import { FakeContext, fakeFetch, fakeStretchLoader, flush, type FakeGain } from "./fake-audio.ts";

// Request 135-engine-loop-switch: Engine.setLoop(on) and EngineState.loop (default true). With loop
// off, a loop plays to the end of its current pass, then the engine pauses at 0. The end is placed on
// the audio clock: the voice fades out at the loop end and stops just after.
// Fake context at 48 kHz. Loop: 2 s (decoded 2.1 s). Stretch latency 0.12 s, so a change is heard at now + 0.14 s.
const url = (id: string) => `https://p.example.com/${id}.mp3`;
const loop = (id: string): Playable => ({ kind: "loop", id, previewUrl: url(id), loopSamples: 88200, sampleRate: 44100, bpm: 140 });
const oneshot = (id: string): Playable => ({ kind: "oneshot", id, previewUrl: url(id) });
const LOOP_S = 2;
const LEAD = 0.14;
const STOP_AFTER = 0.03;

async function settle() {
  for (let i = 0; i < 10; i++) await flush();
}

function setup() {
  const net = fakeFetch({ [url("a")]: 2100, [url("s")]: 500 });
  const ctx = new FakeContext();
  const stretch = fakeStretchLoader();
  // The engine's waits on the audio clock resolve once a test has moved the fake clock that far.
  const sleeps: number[] = [];
  const waiting: { at: number; resolve: () => void }[] = [];
  const sleep = (s: number) => {
    sleeps.push(s);
    return new Promise<void>((resolve) => waiting.push({ at: ctx.currentTime + s, resolve }));
  };
  const advance = ctx.advance.bind(ctx);
  ctx.advance = (s: number) => {
    advance(s);
    for (const w of waiting.splice(0)) {
      if (w.at <= ctx.currentTime + 1e-9) w.resolve();
      else waiting.push(w);
    }
  };
  const e = new WebAudioEngine({ createContext: () => ctx, fetch: net.fetch, loadStretch: stretch.load, sleep });
  const plainPlaying = () => ctx.playing.filter((s) => s.buffer);
  /** The newest buffer source (a scheduled stop does not count as stopped here, unlike plainPlaying). */
  const latest = () => ctx.sources.filter((s) => s.buffer).at(-1)!;
  const plainGain = (i = -1) => ctx.sources.filter((s) => s.buffer).at(i)!.connected[0] as FakeGain;
  const stretchGain = () => stretch.node.connected[0] as FakeGain;
  return { e, ctx, stretch, node: stretch.node, plainPlaying, latest, plainGain, stretchGain, sleeps };
}

describe("the loop switch", () => {
  it("is on by default, in state and in the initial state", () => {
    expect(INITIAL_STATE.loop).toBe(true);
    expect(new WebAudioEngine().getState().loop).toBe(true);
  });
  it("setLoop updates state and notifies subscribers once per change", () => {
    const { e } = setup();
    const fn = vi.fn();
    e.subscribe(fn);
    e.setLoop(false);
    expect(e.getState().loop).toBe(false);
    e.setLoop(false);
    expect(fn).toHaveBeenCalledTimes(1);
    e.setLoop(true);
    expect(e.getState().loop).toBe(true);
  });
  it("with loop on, a loop keeps repeating", async () => {
    const { e, ctx, plainPlaying } = setup();
    await e.play(loop("a"));
    ctx.advance(5);
    expect(e.getState().status).toBe("playing");
    expect(plainPlaying()).toHaveLength(1);
    expect(e.getPositionMs()).toBeCloseTo(1000);
  });
});

describe("loop off on the plain path", () => {
  it("set before play: plays once, fades at the loop end on the audio clock, then pauses at 0", async () => {
    const { e, ctx, latest, plainGain } = setup();
    e.setLoop(false);
    await e.play(loop("a"));
    const src = latest();
    expect(src.stoppedAt).toBeCloseTo(LOOP_S + STOP_AFTER);
    expect(plainGain().gain.at(LOOP_S - 0.001)).toBeCloseTo(1);
    expect(plainGain().gain.at(LOOP_S + STOP_AFTER)).toBeLessThan(0.01);
    ctx.advance(1.9);
    expect(e.getState().status).toBe("playing");
    ctx.advance(0.2);
    expect(e.getState()).toMatchObject({ status: "paused", loop: false });
    expect(e.getPositionMs()).toBe(0);
  });
  it("set mid-pass after a few repeats: ends at the end of the pass now playing", async () => {
    const { e, ctx, latest } = setup();
    await e.play(loop("a"));
    ctx.advance(2.5); // second pass, 0.5 s in
    e.setLoop(false);
    expect(latest().stoppedAt).toBeCloseTo(2 * LOOP_S + STOP_AFTER);
    ctx.advance(1.6);
    expect(e.getState()).toMatchObject({ status: "paused" });
    expect(e.getPositionMs()).toBe(0);
  });
  it("play after the end starts again from 0 and ends again after one pass", async () => {
    const { e, ctx, latest } = setup();
    e.setLoop(false);
    await e.play(loop("a"));
    ctx.advance(2.1);
    await e.play();
    expect(e.getState().status).toBe("playing");
    const src = latest();
    expect(src.startOffset).toBe(0);
    expect(src.stoppedAt).toBeCloseTo(2.1 + LOOP_S + STOP_AFTER);
  });
  it("a seek with loop off ends at the end of the pass from the new position", async () => {
    const { e, ctx, latest } = setup();
    e.setLoop(false);
    await e.play(loop("a"));
    ctx.advance(0.5);
    e.seek(1500);
    expect(latest().stoppedAt).toBeCloseTo(0.5 + 0.5 + STOP_AFTER);
  });
  it("pause and resume with loop off still ends at the loop end", async () => {
    const { e, ctx, latest } = setup();
    e.setLoop(false);
    await e.play(loop("a"));
    ctx.advance(0.5);
    e.pause();
    ctx.advance(1);
    await e.play();
    expect(latest().stoppedAt).toBeCloseTo(1.5 + 1.5 + STOP_AFTER);
  });
  it("turned back on before the end: carries on from the loop start at the loop end, with no gap", async () => {
    const { e, ctx, plainPlaying, plainGain } = setup();
    await e.play(loop("a"));
    ctx.advance(0.5);
    e.setLoop(false);
    ctx.advance(0.5);
    e.setLoop(true);
    // The first voice cannot be unstopped: a second one takes over at the loop end, from sample 0.
    const [first, next] = ctx.sources.filter((s) => s.buffer);
    expect(next).toBeDefined();
    expect(next!.startedAt).toBeCloseTo(LOOP_S);
    expect(next!.startOffset).toBe(0);
    expect(next!.loop).toBe(true);
    expect(next!.stoppedAt).toBeNull();
    expect(plainGain(0).gain.at(LOOP_S - 0.001), "the first plays to the loop end at full level").toBeCloseTo(1);
    expect(plainGain(0).gain.at(LOOP_S), "and is silent from it").toBe(0);
    expect(plainGain(1).gain.at(LOOP_S), "the next is at full level from it").toBe(1);
    expect(first!.stoppedAt).toBeCloseTo(LOOP_S + STOP_AFTER);
    ctx.advance(1.5);
    expect(e.getState().status).toBe("playing");
    expect(plainPlaying()).toEqual([next]);
    expect(e.getPositionMs()).toBeCloseTo(500);
    ctx.advance(10);
    expect(e.getState().status).toBe("playing");
  });
  it("does nothing to one-shots, which end by themselves", async () => {
    const { e, ctx, plainPlaying } = setup();
    e.setLoop(true);
    await e.play(oneshot("s"));
    expect(plainPlaying()[0]!.stoppedAt).toBeNull();
    e.setLoop(false);
    expect(plainPlaying()[0]!.stoppedAt).toBeNull();
    ctx.advance(0.6);
    expect(e.getState().status).toBe("paused");
  });
});

describe("loop off through the stretch", () => {
  async function stretched() {
    const s = setup();
    await s.e.play(loop("a"));
    s.e.setTempo(70); // ratio 0.5: one pass is 4 s of output
    await settle();
    return s;
  }
  /** The end the engine should place, from the stretch's last start or change. */
  const endFrom = (change: { output?: number; input?: number; rate?: number }) => change.output! + (LOOP_S - (change.input! - 1)) / change.rate!; // input is pad (1 s) + position

  it("fades out when the position reaches the loop end at the stretched tempo, then stops and pauses at 0", async () => {
    const { e, ctx, node, stretchGain } = await stretched();
    const start = node.lastStart!;
    const sent = node.schedules.length;
    e.setLoop(false);
    const end = endFrom(start);
    expect(end).toBeCloseTo(LEAD + (LOOP_S - LEAD) / 0.5);
    // The worklet keeps one pending change: nothing is sent to it while the start or the end waits.
    expect(node.schedules).toHaveLength(sent);
    expect(stretchGain().gain.at(end - 0.001)).toBeCloseTo(1, 2);
    expect(stretchGain().gain.at(end + STOP_AFTER)).toBeLessThan(0.01);
    ctx.advance(end - 0.1 - ctx.currentTime);
    await settle();
    expect(e.getState().status).toBe("playing");
    ctx.advance(0.2);
    await settle();
    expect(e.getState()).toMatchObject({ status: "paused", tempoRatio: 0.5, loop: false });
    expect(node.schedules.at(-1), "told to stop once silent").toMatchObject({ active: false });
    expect(node.schedules.at(-1)!.output).toBeGreaterThanOrEqual(end + STOP_AFTER - 1e-9);
    expect(e.getPositionMs()).toBe(0);
  });
  it("a tempo change with loop off moves the end to match the new tempo", async () => {
    const { e, ctx, node, stretchGain } = await stretched();
    e.setLoop(false);
    const oldEnd = endFrom(node.lastStart!);
    ctx.advance(1);
    e.setTempo(140); // back to ratio 1, still on the stretch
    const change = node.schedules.at(-1)!;
    expect(change).toMatchObject({ active: true, rate: 1 });
    const end = endFrom(change);
    expect(end).toBeLessThan(oldEnd);
    expect(stretchGain().gain.at(end - 0.001)).toBeCloseTo(1, 2);
    expect(stretchGain().gain.at(end + STOP_AFTER)).toBeLessThan(0.01);
    ctx.advance(end + 0.05 - ctx.currentTime);
    await settle();
    expect(e.getState().status).toBe("paused");
  });
  it("turned back on before the end: the fade is taken back and the loop carries on", async () => {
    const { e, ctx, node, stretchGain } = await stretched();
    e.setLoop(false);
    const end = endFrom(node.lastStart!);
    const sent = node.schedules.length;
    ctx.advance(0.5);
    e.setLoop(true);
    expect(stretchGain().gain.at(end + STOP_AFTER)).toBeCloseTo(1, 2);
    ctx.advance(end + 1 - ctx.currentTime);
    await settle();
    expect(e.getState().status).toBe("playing");
    expect(node.schedules).toHaveLength(sent);
  });
  it("a loop that starts on the stretch with loop off keeps its start, and ends after one pass", async () => {
    const { e, ctx, node, stretchGain } = setup();
    e.setLoop(false);
    e.setTranspose(3);
    await e.play(loop("a"));
    await settle();
    const start = node.lastStart!;
    expect(start.output).toBeCloseTo(LEAD);
    expect(node.schedules.at(-1), "nothing sent after the start, which would drop it").toBe(start);
    const end = endFrom(start);
    expect(end).toBeCloseTo(LEAD + LOOP_S);
    expect(stretchGain().gain.at(end + STOP_AFTER)).toBeLessThan(0.01);
    ctx.advance(end - 0.1 - ctx.currentTime);
    await settle();
    expect(e.getState().status).toBe("playing");
    ctx.advance(0.2);
    await settle();
    expect(e.getState()).toMatchObject({ status: "paused", transpose: 3 });
  });
  it("a handoff from plain to stretch with loop off places the end on the stretch", async () => {
    const { e, ctx, node, stretchGain } = setup();
    e.setLoop(false);
    await e.play(loop("a"));
    ctx.advance(0.5);
    e.setTempo(70);
    await settle();
    const start = node.lastStart!;
    expect(node.schedules.at(-1)).toBe(start);
    const end = endFrom(start);
    expect(end).toBeCloseTo(start.output! + (LOOP_S - (start.output! - 0)) / 0.5, 5);
    expect(stretchGain().gain.at(end - 0.001)).toBeCloseTo(1, 2);
    expect(stretchGain().gain.at(end + STOP_AFTER)).toBeLessThan(0.01);
    ctx.advance(end + 0.05 - ctx.currentTime);
    await settle();
    expect(e.getState().status).toBe("paused");
  });
});

// PR #10 delta review (lead, must-fix 1): every re-timing takes back the fade it placed before.
describe("loop off: the end moves later", () => {
  it("slowing the tempo twice leaves no fade at either earlier end", async () => {
    const { e, ctx, node, stretchGain } = setup();
    await e.play(loop("a"));
    e.setTempo(70); // ratio 0.5
    await settle();
    e.setLoop(false);
    const endOf = (c: { output?: number; input?: number; rate?: number }) => c.output! + (LOOP_S - (c.input! - 1)) / c.rate!;
    const first = endOf(node.lastStart!);
    ctx.advance(0.3);
    e.setTempo(60);
    const second = endOf(node.schedules.at(-1)!);
    ctx.advance(0.3);
    e.setTempo(50);
    const third = endOf(node.schedules.at(-1)!);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    const gain = stretchGain().gain;
    for (const old of [first, second]) {
      expect(gain.at(old + 0.001), `no fade left at ${old.toFixed(3)} s`).toBeCloseTo(1, 3);
      expect(gain.at(old + STOP_AFTER), `no fade left at ${old.toFixed(3)} s`).toBeCloseTo(1, 3);
    }
    expect(gain.at(third + STOP_AFTER)).toBeLessThan(0.01);
    ctx.advance(second + 0.1 - ctx.currentTime);
    await settle();
    expect(e.getState().status, "still playing past the earlier ends").toBe("playing");
  });
});

// PR #10 delta review (lead, must-fix 2): once the end is less than a lead away, a tempo or key change
// can no longer be heard in this pass. The pass finishes, the engine pauses at 0, and the change is
// kept for the next play.
describe("loop off: a tempo or key change too close to the end", () => {
  it("plain path: no handoff; the pass ends at the loop end and the next play uses the new tempo", async () => {
    const { e, ctx, node, latest, plainGain } = setup();
    e.setLoop(false);
    await e.play(loop("a"));
    ctx.advance(LOOP_S - 0.1); // the end is 0.1 s away, less than a lead (0.14 s)
    e.setTempo(70);
    await settle();
    expect(node.lastStart, "the stretch is not started for a pass that is ending").toBeUndefined();
    expect(latest().stoppedAt).toBeCloseTo(LOOP_S + STOP_AFTER);
    expect(plainGain().gain.at(LOOP_S + STOP_AFTER), "the fade at the loop end stands").toBeLessThan(0.01);
    expect(e.getState().tempoRatio).toBe(0.5);
    ctx.advance(0.2);
    await settle();
    expect(e.getState()).toMatchObject({ status: "paused", tempoRatio: 0.5 });
    expect(e.getPositionMs()).toBe(0);
    await e.play();
    await settle();
    expect(node.lastStart).toMatchObject({ active: true, rate: 0.5, input: 1 });
  });
  it("stretch path: a change just before the end sends nothing, and the pass ends there", async () => {
    const { e, ctx, node, stretchGain } = setup();
    await e.play(loop("a"));
    e.setTempo(70);
    await settle();
    e.setLoop(false);
    const start = node.lastStart!;
    const end = start.output! + (LOOP_S - (start.input! - 1)) / 0.5;
    const sent = node.schedules.length;
    ctx.advance(end - 0.05 - ctx.currentTime);
    e.setTempo(50);
    e.setTranspose(2);
    expect(node.schedules, "nothing sent for a pass that is ending").toHaveLength(sent);
    expect(stretchGain().gain.at(end + STOP_AFTER)).toBeLessThan(0.01);
    ctx.advance(0.1);
    await settle();
    expect(e.getState()).toMatchObject({ status: "paused", tempoRatio: 50 / 140, transpose: 2 });
    expect(e.getPositionMs()).toBe(0);
  });
  it("stretch path: a change during the final fade does not re-time to the next pass", async () => {
    const { e, ctx, node } = setup();
    await e.play(loop("a"));
    e.setTempo(70);
    await settle();
    e.setLoop(false);
    const start = node.lastStart!;
    const end = start.output! + (LOOP_S - (start.input! - 1)) / 0.5;
    ctx.advance(end + 0.01 - ctx.currentTime); // inside the 30 ms after the end
    e.setTempo(50);
    ctx.advance(0.05);
    await settle();
    expect(e.getState(), "paused, not playing a silent pass").toMatchObject({ status: "paused" });
    expect(e.getPositionMs()).toBe(0);
  });
});

// PR #10 delta review (lead, advisory): loop switched back on during the final fade carries on from the
// start of the next pass without a gap.
describe("loop switched back on during the final fade", () => {
  it("plain path: a new voice from where the next pass is, ramping in while the old one fades", async () => {
    const { e, ctx, latest } = setup();
    e.setLoop(false);
    await e.play(loop("a"));
    ctx.advance(LOOP_S + 0.01); // 10 ms into the fade
    const fading = latest();
    e.setLoop(true);
    const next = latest();
    expect(next).not.toBe(fading);
    expect(next.startedAt).toBeCloseTo(LOOP_S + 0.01);
    expect(next.startOffset).toBeCloseTo(0.01);
    expect(next.loop).toBe(true);
    expect(next.stoppedAt).toBeNull();
    const g = next.connected[0] as FakeGain;
    expect(g.gain.at(LOOP_S + 0.01)).toBe(0);
    expect(g.gain.at(LOOP_S + 0.05)).toBeGreaterThan(0.99);
    ctx.advance(1);
    await settle();
    expect(e.getState().status).toBe("playing");
    expect(e.getPositionMs()).toBeCloseTo(1010);
  });
  it("stretch path: the gain ramps back up from where the fade has got to, with nothing sent", async () => {
    const { e, ctx, node, stretchGain } = setup();
    await e.play(loop("a"));
    e.setTempo(70);
    await settle();
    e.setLoop(false);
    const start = node.lastStart!;
    const end = start.output! + (LOOP_S - (start.input! - 1)) / 0.5;
    const sent = node.schedules.length;
    ctx.advance(end + 0.01 - ctx.currentTime);
    const gain = stretchGain().gain;
    const now = ctx.currentTime;
    const before = gain.at(now);
    e.setLoop(true);
    expect(gain.at(now), "no jump: the ramp starts from the fade's value").toBeCloseTo(before, 6);
    expect(gain.at(now + 0.05)).toBeGreaterThan(0.99);
    expect(node.schedules).toHaveLength(sent);
    ctx.advance(1);
    await settle();
    expect(e.getState().status).toBe("playing");
  });
});
