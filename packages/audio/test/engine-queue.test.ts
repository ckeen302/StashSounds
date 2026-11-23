import { describe, expect, it, vi } from "vitest";
import { WebAudioEngine } from "../src/engine.ts";
import type { Playable } from "../src/types.ts";
import { FakeContext, fakeFetch, fakeStretchLoader, flush } from "./fake-audio.ts";

const url = (id: string) => `https://p.example.com/${id}.mp3`;
const loop = (id: string): Playable => ({ kind: "loop", id, previewUrl: url(id), loopSamples: 88200, sampleRate: 44100, bpm: 140 });
const [a, b, c, d, x] = ["a", "b", "c", "d", "x"].map(loop) as [Playable, Playable, Playable, Playable, Playable];

async function settle() {
  for (let i = 0; i < 10; i++) await flush();
}

function setup(routes: Parameters<typeof fakeFetch>[0] = {}) {
  const net = fakeFetch({ [url("a")]: 2100, [url("b")]: 2100, [url("c")]: 2100, [url("d")]: 2100, [url("x")]: 2100, ...routes });
  const ctx = new FakeContext();
  const e = new WebAudioEngine({ createContext: () => ctx, fetch: net.fetch, loadStretch: fakeStretchLoader().load });
  return { e, net, ctx };
}

describe("preload", () => {
  it("play() of a preloaded item needs no network at all", async () => {
    const { e, net } = setup();
    await e.unlock();
    e.preload(a);
    await settle();
    net.routes[url("a")] = "network-error"; // the network is gone
    await e.play(a);
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "a" } });
    expect(net.calls).toEqual([url("a")]);
  });
  it("a preload made before the first gesture is decoded on play without fetching again", async () => {
    const { e, net, ctx } = setup();
    e.preload(a);
    await settle();
    net.routes[url("a")] = "network-error";
    await e.play(a);
    expect(e.getState().status).toBe("playing");
    expect(ctx.decodeCalls).toBe(1);
  });
});

describe("the queue preloads the neighbours", () => {
  it("setQueue preloads the start item, then the items either side of it", async () => {
    const { e, net, ctx } = setup();
    await e.unlock();
    e.setQueue([a, b, c], 1);
    await settle();
    expect(net.calls).toEqual([url("b"), url("c"), url("a")]);
    expect(ctx.decodeCalls).toBe(3);
  });
  it("neighbours wait until the current item has loaded, so they never compete with it", async () => {
    const { e, net } = setup();
    net.hold(url("a"));
    e.setQueue([a, b], 0);
    await settle();
    expect(net.calls).toEqual([url("a")]);
    net.release(url("a"));
    await settle();
    expect(net.calls).toEqual([url("a"), url("b")]);
  });
  it("next plays the next item and then preloads the one after it", async () => {
    const { e, net } = setup();
    e.setQueue([a, b, c, d], 0);
    await settle();
    expect(net.calls).toEqual([url("a"), url("b")]);
    net.hold(url("b")); // already fetched: holding it changes nothing
    e.next();
    await settle();
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "b" }, queueIndex: 1 });
    expect(net.calls).toEqual([url("a"), url("b"), url("c")]);
    e.next();
    await settle();
    expect(net.calls).toEqual([url("a"), url("b"), url("c"), url("d")]);
  });
  it("next waits for the current item before fetching the one after it", async () => {
    const { e, net } = setup({ [url("b")]: "network-error" });
    e.setQueue([a, b, c], 0);
    await settle(); // b's preload failed, so b is not cached
    net.routes[url("b")] = 2100;
    net.hold(url("b"));
    const before = net.calls.length;
    e.next();
    await settle();
    expect(net.calls.slice(before)).toEqual([url("b")]); // c waits for b
    net.release(url("b"));
    await settle();
    expect(net.calls.slice(before)).toEqual([url("b"), url("c")]);
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "b" } });
  });
  it("previous plays the item before and preloads the one before that", async () => {
    const { e, net } = setup();
    e.setQueue([a, b, c, d], 3);
    await settle();
    expect(net.calls).toEqual([url("d"), url("c")]);
    e.previous();
    await settle();
    expect(e.getState()).toMatchObject({ current: { id: "c" }, queueIndex: 2 });
    expect(net.calls).toEqual([url("d"), url("c"), url("b")]);
  });
  it("at the ends of the queue there is nothing more to preload", async () => {
    const { e, net } = setup();
    e.setQueue([a, b], 1);
    await settle();
    expect(net.calls).toEqual([url("b"), url("a")]);
    e.next();
    await settle();
    expect(net.calls).toEqual([url("b"), url("a")]);
    expect(e.getState().queueIndex).toBe(1);
  });
  it("an item played from outside the queue does not preload queue neighbours", async () => {
    const { e, net } = setup();
    e.setQueue([a, b, c], 0);
    await settle();
    const before = net.calls.length;
    await e.play(x);
    await settle();
    expect(net.calls.slice(before)).toEqual([url("x")]);
  });
  it("a neighbour that fails to load is silent and changes nothing", async () => {
    const { e, net } = setup({ [url("c")]: "network-error" });
    const fn = vi.fn();
    e.setQueue([a, b, c], 1);
    e.subscribe(fn);
    await settle();
    expect(net.calls).toContain(url("c"));
    expect(fn).not.toHaveBeenCalled();
    expect(e.getState().status).toBe("idle");
  });
  it("a queue replaced before its start item loads does not preload the old neighbours", async () => {
    const { e, net } = setup();
    net.hold(url("a"));
    e.setQueue([a, b], 0);
    await settle();
    e.setQueue([c, d], 0);
    net.release(url("a"));
    await settle();
    expect(net.calls).not.toContain(url("b"));
    expect(net.calls).toEqual(expect.arrayContaining([url("a"), url("c"), url("d")]));
  });
});
