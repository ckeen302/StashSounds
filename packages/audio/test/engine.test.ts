import { describe, expect, it, vi } from "vitest";
import { StateOnlyEngine } from "../src/engine.ts";
import type { Playable } from "../src/types.ts";

const loop = (id: string): Playable => ({ kind: "loop", id, previewUrl: "https://p.example.com/a.mp3", loopSamples: 44100, sampleRate: 44100, bpm: 140 });

describe("engine interface (state-only placeholder)", () => {
  it("plays, pauses and resumes", async () => {
    const e = new StateOnlyEngine();
    await e.play(loop("a"));
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "a" } });
    e.pause();
    expect(e.getState().status).toBe("paused");
    await e.play();
    expect(e.getState().status).toBe("playing");
  });
  it("notifies subscribers and stops after unsubscribe", async () => {
    const e = new StateOnlyEngine();
    const fn = vi.fn();
    const off = e.subscribe(fn);
    await e.play(loop("a"));
    off();
    e.pause();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("moves through the queue", async () => {
    const e = new StateOnlyEngine();
    e.setQueue([loop("a"), loop("b")]);
    e.next();
    expect(e.getState()).toMatchObject({ queueIndex: 1, current: { id: "b" } });
    e.next();
    expect(e.getState().queueIndex).toBe(1);
    e.previous();
    expect(e.getState().current?.id).toBe("a");
  });
  it("clamps transpose and volume and derives tempo ratio from the loop's BPM", async () => {
    const e = new StateOnlyEngine();
    await e.play(loop("a"));
    e.setTranspose(20);
    e.setVolume(2);
    e.setTempo(70);
    expect(e.getState()).toMatchObject({ transpose: 12, volume: 1, tempoRatio: 0.5 });
  });
});
