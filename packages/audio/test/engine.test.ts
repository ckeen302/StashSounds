import { describe, expect, it, vi } from "vitest";
import { WebAudioEngine, getEngine } from "../src/engine.ts";
import type { Playable } from "../src/types.ts";
import { FakeContext, fakeFetch, flush } from "./fake-audio.ts";

const url = (id: string) => `https://p.example.com/${id}.mp3`;
// 2 s loop at 44.1 kHz; the decoded preview is 2.1 s (MP3 padding), so the loop length must come from loopSamples.
const loop = (id: string): Playable => ({ kind: "loop", id, previewUrl: url(id), loopSamples: 88200, sampleRate: 44100, bpm: 140 });
const oneshot = (id: string): Playable => ({ kind: "oneshot", id, previewUrl: url(id) });
const preset = (id: string): Playable => ({ kind: "preset", id, demoUrl: url(id) });
const kit = (id: string): Playable => ({ kind: "kit", id, pads: [{ index: 0, name: "Kick", category: "kick", previewUrl: url(`${id}-kick`) }] });

function setup(routes: Parameters<typeof fakeFetch>[0] = {}) {
  const net = fakeFetch({ [url("a")]: 2100, [url("b")]: 2100, [url("c")]: 2100, [url("s")]: 500, [url("p")]: 3000, ...routes });
  const contexts: FakeContext[] = [];
  const createContext = vi.fn(() => {
    const c = new FakeContext();
    contexts.push(c);
    return c;
  });
  const e = new WebAudioEngine({ createContext, fetch: net.fetch });
  return { e, net, createContext, ctx: () => contexts[0]!, contexts };
}

describe("engine interface (kept from the placeholder)", () => {
  it("plays, pauses and resumes", async () => {
    const { e } = setup();
    await e.play(loop("a"));
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "a" } });
    e.pause();
    expect(e.getState().status).toBe("paused");
    await e.play();
    expect(e.getState().status).toBe("playing");
  });
  it("notifies subscribers and stops after unsubscribe", async () => {
    const { e } = setup();
    const fn = vi.fn();
    const off = e.subscribe(fn);
    await e.play(loop("a"));
    expect(fn).toHaveBeenLastCalledWith(expect.objectContaining({ status: "playing" }));
    const calls = fn.mock.calls.length;
    off();
    e.pause();
    expect(fn).toHaveBeenCalledTimes(calls);
  });
  it("moves through the queue", async () => {
    const { e } = setup();
    e.setQueue([loop("a"), loop("b")]);
    e.next();
    expect(e.getState()).toMatchObject({ queueIndex: 1, current: { id: "b" } });
    e.next();
    expect(e.getState().queueIndex).toBe(1);
    e.previous();
    expect(e.getState().current?.id).toBe("a");
  });
  it("clamps transpose and volume and derives tempo ratio from the loop's BPM", async () => {
    const { e } = setup();
    await e.play(loop("a"));
    e.setTranspose(20);
    e.setVolume(2);
    e.setTempo(70);
    expect(e.getState()).toMatchObject({ transpose: 12, volume: 1, tempoRatio: 0.5 });
  });
});

describe("unlock and the audio context", () => {
  it("creates no context until unlock, then exactly one for the session", async () => {
    const { e, createContext, ctx } = setup();
    e.preload(loop("a"));
    e.getState();
    e.getPositionMs();
    expect(createContext).not.toHaveBeenCalled();
    await e.unlock();
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(ctx().state).toBe("running");
    await e.unlock();
    await e.play(loop("a"));
    await e.play(loop("b"));
    expect(createContext).toHaveBeenCalledTimes(1);
  });
  it("creates the context synchronously inside the gesture, before any await", () => {
    const { e, createContext } = setup();
    void e.unlock();
    expect(createContext).toHaveBeenCalledTimes(1);
    const f = setup();
    void f.e.play(loop("a"));
    expect(f.createContext).toHaveBeenCalledTimes(1);
  });
  it("resumes a context the browser suspended or interrupted", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    ctx().state = "interrupted";
    e.pause();
    await e.play();
    expect(ctx().state).toBe("running");
    expect(ctx().resumeCalls).toBe(2);
    expect(e.getState().status).toBe("playing");
  });
  it("sets status error and does not throw when Web Audio is missing", async () => {
    const e = new WebAudioEngine({
      createContext: () => {
        throw new Error("Web Audio is not available");
      },
      fetch: fakeFetch({}).fetch,
    });
    await expect(e.unlock()).resolves.toBeUndefined();
    expect(e.getState().status).toBe("error");
    await expect(e.play(loop("a"))).resolves.toBeUndefined();
    expect(e.getState()).toMatchObject({ status: "error", current: { id: "a" } });
  });
  it("sets status error when resume is refused, and play() retries", async () => {
    const ctx = new FakeContext();
    ctx.failResume = true;
    const e = new WebAudioEngine({ createContext: () => ctx, fetch: fakeFetch({ [url("a")]: 2100 }).fetch });
    await expect(e.unlock()).resolves.toBeUndefined();
    expect(e.getState().status).toBe("error");
    ctx.failResume = false;
    await e.play(loop("a"));
    expect(e.getState().status).toBe("playing");
  });
  it("getEngine returns one instance for the session, kept on globalThis", () => {
    const a = getEngine();
    expect(getEngine()).toBe(a);
    const key = Symbol.for("stash.audio.engine");
    expect((globalThis as Record<symbol, unknown>)[key]).toBe(a);
  });
});

describe("load and play", () => {
  it("loops a loop on loopSamples at sampleRate, not the decoded length", async () => {
    const { e, ctx } = setup();
    const states: string[] = [];
    e.subscribe((s) => states.push(s.status));
    await e.play(loop("a"));
    expect(states).toEqual(["loading", "playing"]);
    const [src] = ctx().playing;
    expect(src).toBeDefined();
    expect(src!.loop).toBe(true);
    expect(src!.loopStart).toBe(0);
    expect(src!.loopEnd).toBe(2);
    expect(src!.startOffset).toBe(0);
    expect(e.getState().durationMs).toBe(2000);
  });
  it("plays a one-shot once and returns to paused at 0 when it ends", async () => {
    const { e, ctx } = setup();
    await e.play(oneshot("s"));
    const [src] = ctx().playing;
    expect(src!.loop).toBe(false);
    expect(e.getState().durationMs).toBe(500);
    ctx().advance(0.6);
    expect(e.getState().status).toBe("paused");
    expect(e.getPositionMs()).toBe(0);
  });
  it("plays a preset's demo audio", async () => {
    const { e, net } = setup();
    await e.play(preset("p"));
    expect(net.calls).toEqual([url("p")]);
    expect(e.getState()).toMatchObject({ status: "playing", durationMs: 3000 });
  });
  it("routes every voice through one master gain to the destination", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    await e.play(loop("b"));
    const master = ctx().gains[0]!;
    expect(master.connected).toEqual([ctx().destination]);
    for (const s of ctx().sources) expect(s.connected).toHaveLength(1);
    expect(ctx().gains.slice(1).every((g) => g.connected[0] === master)).toBe(true);
  });
  it("keeps exactly one voice when moving between items", async () => {
    const { e, ctx } = setup();
    e.setQueue([loop("a"), loop("b"), loop("c")]);
    await e.play(loop("a"));
    e.next();
    await flush();
    e.next();
    await flush();
    ctx().advance(0.1);
    expect(ctx().playing).toHaveLength(1);
    expect(ctx().playing[0]!.buffer).toBeTruthy();
    expect(e.getState()).toMatchObject({ current: { id: "c" }, status: "playing" });
  });
  it("a slow earlier load never starts after a later play", async () => {
    const { e, net, ctx } = setup();
    net.hold(url("a"));
    const first = e.play(loop("a"));
    await flush();
    await e.play(loop("b"));
    net.release(url("a"));
    await first;
    await flush();
    expect(ctx().playing).toHaveLength(1);
    expect(e.getState()).toMatchObject({ current: { id: "b" }, status: "playing" });
  });
  it("play of the item already playing does not restart it", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    ctx().advance(0.5);
    await e.play(loop("a"));
    expect(ctx().sources).toHaveLength(1);
    expect(e.getPositionMs()).toBe(500);
  });
  it("play() with nothing loaded does nothing", async () => {
    const { e, net } = setup();
    await e.play();
    expect(e.getState().status).toBe("idle");
    expect(net.calls).toEqual([]);
  });
  it("kits and MIDI are accepted without sound until their players land (221, 223)", async () => {
    const { e, net } = setup();
    await expect(e.play(kit("k"))).resolves.toBeUndefined();
    expect(e.getState()).toMatchObject({ status: "idle", current: { id: "k" } });
    expect(net.calls).toEqual([]);
  });
});

describe("failures are quiet and recoverable", () => {
  it.each([
    ["an HTTP error", { status: 404 }],
    ["a network error", "network-error"],
  ] as const)("%s sets status error, keeps the item, and play() retries", async (_, route) => {
    const { e, net } = setup({ [url("a")]: route });
    await expect(e.play(loop("a"))).resolves.toBeUndefined();
    expect(e.getState()).toMatchObject({ status: "error", current: { id: "a" } });
    net.routes[url("a")] = 2100;
    await e.play();
    expect(e.getState().status).toBe("playing");
  });
  it("a decode error sets status error and the retry decodes fresh bytes", async () => {
    const { e, ctx, net } = setup();
    void e.unlock();
    ctx().failDecode.add(2100);
    await e.play(loop("a"));
    expect(e.getState().status).toBe("error");
    ctx().failDecode.clear();
    await e.play(loop("a"));
    expect(e.getState().status).toBe("playing");
    expect(net.calls).toEqual([url("a"), url("a")]);
  });
  it("a failed preload is silent and leaves state alone", async () => {
    const { e } = setup({ [url("a")]: "network-error" });
    const fn = vi.fn();
    e.subscribe(fn);
    expect(() => e.preload(loop("a"))).not.toThrow();
    await flush();
    expect(fn).not.toHaveBeenCalled();
    expect(e.getState().status).toBe("idle");
  });
  it("a listener that throws does not break the engine or other listeners", async () => {
    const { e } = setup();
    const good = vi.fn();
    e.subscribe(() => {
      throw new Error("bad listener");
    });
    e.subscribe(good);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(e.play(loop("a"))).resolves.toBeUndefined();
    expect(e.getState().status).toBe("playing");
    expect(good).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("preload", () => {
  it("fetches before unlock and play uses those bytes", async () => {
    const { e, net, createContext } = setup();
    e.preload(loop("a"));
    await flush();
    expect(net.calls).toEqual([url("a")]);
    expect(createContext).not.toHaveBeenCalled();
    await e.play(loop("a"));
    expect(net.calls).toEqual([url("a")]);
    expect(e.getState().status).toBe("playing");
  });
  it("decodes ahead once the context exists", async () => {
    const { e, ctx } = setup();
    await e.unlock();
    e.preload(oneshot("s"));
    await flush();
    expect(ctx().decodeCalls).toBe(1);
    await e.play(oneshot("s"));
    expect(ctx().decodeCalls).toBe(1);
  });
});

describe("position reads the audio clock", () => {
  it("advances with currentTime, freezes on pause and continues on resume", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    expect(e.getPositionMs()).toBe(0);
    ctx().advance(0.75);
    expect(e.getPositionMs()).toBe(750);
    e.pause();
    ctx().advance(5);
    expect(e.getPositionMs()).toBe(750);
    await e.play();
    expect(ctx().playing.at(-1)!.startOffset).toBeCloseTo(0.75);
    ctx().advance(0.25);
    expect(e.getPositionMs()).toBe(1000);
  });
  it("wraps around the loop length", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    ctx().advance(2.5);
    expect(e.getPositionMs()).toBeCloseTo(500);
  });
  it("is not state: the clock moving notifies nobody", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    const fn = vi.fn();
    e.subscribe(fn);
    ctx().advance(1);
    e.getPositionMs();
    expect(fn).not.toHaveBeenCalled();
    expect(e.getState()).not.toHaveProperty("positionMs");
  });
  it("does not use timers", async () => {
    vi.useFakeTimers();
    try {
      const { e } = setup();
      void e.play(loop("a"));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pause", () => {
  it("stops the voice with a short fade instead of a click", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    ctx().advance(1);
    e.pause();
    const voiceGain = ctx().gains[1]!;
    expect(voiceGain.gain.events.at(-1)).toMatchObject({ type: "target", value: 0, time: 1 });
    const src = ctx().sources[0]!;
    expect(src.stoppedAt).toBeGreaterThan(1);
    expect(src.stoppedAt).toBeLessThan(1.05);
  });
  it("during loading keeps the item and does not start it when the load lands", async () => {
    const { e, net, ctx } = setup();
    net.hold(url("a"));
    const p = e.play(loop("a"));
    await flush();
    e.pause();
    net.release(url("a"));
    await p;
    expect(e.getState()).toMatchObject({ status: "paused", current: { id: "a" } });
    expect(ctx().playing).toHaveLength(0);
    await e.play();
    expect(e.getState().status).toBe("playing");
  });
  it("does nothing when idle", () => {
    const { e } = setup();
    const fn = vi.fn();
    e.subscribe(fn);
    e.pause();
    expect(fn).not.toHaveBeenCalled();
  });
  it("a paused one-shot's ending does not reset it", async () => {
    const { e, ctx } = setup();
    await e.play(oneshot("s"));
    ctx().advance(0.2);
    e.pause();
    ctx().advance(1);
    expect(e.getPositionMs()).toBe(200);
    expect(e.getState().status).toBe("paused");
  });
});

describe("seek", () => {
  it("while playing restarts the voice at the new offset", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    e.seek(1500);
    expect(ctx().playing).toHaveLength(1);
    expect(ctx().playing[0]!.startOffset).toBeCloseTo(1.5);
    expect(e.getPositionMs()).toBe(1500);
    ctx().advance(0.1);
    expect(e.getPositionMs()).toBeCloseTo(1600);
    expect(e.getState().status).toBe("playing");
  });
  it("while paused stores the offset for resume", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    e.pause();
    e.seek(400);
    expect(e.getPositionMs()).toBe(400);
    await e.play();
    expect(ctx().playing[0]!.startOffset).toBeCloseTo(0.4);
  });
  it("clamps below zero, wraps on loops and clamps to the end on one-shots", async () => {
    const { e } = setup();
    await e.play(loop("a"));
    e.seek(-50);
    expect(e.getPositionMs()).toBe(0);
    e.seek(2500);
    expect(e.getPositionMs()).toBeCloseTo(500);
    await e.play(oneshot("s"));
    e.pause();
    e.seek(9000);
    expect(e.getPositionMs()).toBe(500);
  });
  it("during loading applies when playback starts", async () => {
    const { e, net, ctx } = setup();
    net.hold(url("a"));
    const p = e.play(loop("a"));
    await flush();
    e.seek(1000);
    net.release(url("a"));
    await p;
    expect(ctx().playing[0]!.startOffset).toBeCloseTo(1);
  });
  it("ignores a non-finite position", async () => {
    const { e, ctx } = setup();
    await e.play(loop("a"));
    ctx().advance(0.3);
    e.seek(Number.NaN);
    expect(e.getPositionMs()).toBe(300);
  });
});

describe("volume and the remaining controls", () => {
  it("setVolume drives the master gain, before and after unlock", async () => {
    const { e, ctx } = setup();
    e.setVolume(0.3);
    await e.unlock();
    expect(ctx().gains[0]!.gain.value).toBeCloseTo(0.3);
    e.setVolume(-1);
    expect(ctx().gains[0]!.gain.value).toBe(0);
    expect(e.getState().volume).toBe(0);
  });
  it("setTempo ignores items without a BPM and non-positive values", async () => {
    const { e } = setup();
    await e.play(oneshot("s"));
    e.setTempo(90);
    expect(e.getState().tempoRatio).toBe(1);
    await e.play(loop("a"));
    e.setTempo(0);
    expect(e.getState().tempoRatio).toBe(1);
  });
  it("pads, notes and sounds are safe no-ops until 221 to 224", () => {
    const { e } = setup();
    expect(() => {
      e.setSound("808");
      e.triggerPad(0, 1);
      e.noteOn(60, 0.8);
      e.noteOff(60);
    }).not.toThrow();
  });
  it("setQueue clamps the start index and an empty queue resets it", () => {
    const { e } = setup();
    e.setQueue([loop("a"), loop("b")], 9);
    expect(e.getState().queueIndex).toBe(1);
    e.setQueue([]);
    expect(e.getState().queueIndex).toBe(-1);
    e.previous();
    e.next();
    expect(e.getState().current).toBeNull();
  });
});
