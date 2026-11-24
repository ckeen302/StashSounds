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

describe("downloads in the background", () => {
  it("a sweep over 40 rows keeps at most 4 previews in flight and aborts the ones it drops", async () => {
    const items = Array.from({ length: 40 }, (_, i) => loop(`h${i}`));
    const urls = items.map((i) => url(i.id));
    const net = fakeFetch(Object.fromEntries(urls.map((u) => [u, 2100])));
    for (const u of urls) net.hold(u);
    const e = new WebAudioEngine({ createContext: () => new FakeContext(), fetch: net.fetch, loadStretch: fakeStretchLoader().load });
    for (const item of items) {
      e.preload(item); // hover, row after row
      await flush();
    }
    await settle();
    expect(net.stats.inFlight).toBe(4);
    expect(net.stats.maxInFlight).toBe(4);
    // The cap keeps the newest 32. Rows 0-3 started first and were aborted as rows 32-35 arrived (which
    // took their slots); rows 4-7 were dropped while still waiting, so they never went out.
    expect([...net.aborted].sort()).toEqual(urls.slice(0, 4).sort());
    for (const u of urls.slice(4, 8)) expect(net.calls).not.toContain(u);
    expect(net.calls.slice(4)).toEqual(urls.slice(32, 36));
    // As slots free up, the newest waiting row goes next.
    for (const u of urls.slice(32, 36)) net.release(u);
    await settle();
    expect(net.calls.slice(8, 12)).toEqual([urls[39], urls[38], urls[37], urls[36]]);
    for (const u of urls) net.release(u);
    await settle();
    expect(net.stats.maxInFlight).toBe(4);
    expect(new Set(net.calls.filter((u) => urls.slice(8).includes(u))).size).toBe(32);
    expect(net.calls).toHaveLength(36);
  });
  it("playing another item aborts the download of the one it replaces", async () => {
    const { e, net } = setup();
    net.hold(url("a"));
    void e.play(a);
    await settle();
    await e.play(b);
    expect(net.aborted).toEqual([url("a")]);
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "b" } });
  });
  it("the playing item stays decoded however much is preloaded after it", async () => {
    // FakeContext decodes n bytes into n ms of stereo at 48 kHz (384000 bytes of PCM a second). 200 s
    // is about 77 MB and 100 s about 38 MB, so together they pass the 96 MB budget.
    const { e, net, ctx } = setup({ [url("a")]: 200_000, [url("b")]: 100_000 });
    await e.play(a);
    e.preload(b);
    await settle();
    e.setQueue([a, b], 0); // warms a again: still decoded, so no request and no decode
    await settle();
    expect(net.calls.filter((u) => u === url("a"))).toHaveLength(1);
    expect(ctx.decodeCalls).toBe(2);
  });
  it("refuses a preview URL that is not https", async () => {
    const insecure: Playable = { kind: "loop", id: "i", previewUrl: "http://cdn.example.com/i.mp3", loopSamples: 88200, sampleRate: 44100, bpm: 140 };
    const { e, net } = setup({ "http://cdn.example.com/i.mp3": 2100 });
    await e.play(insecure);
    expect(e.getState().status).toBe("error");
    expect(net.calls).toEqual([]);
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
  it("after next, the next item is requested before the previous one", async () => {
    const { e, net } = setup({ [url("a")]: "network-error" });
    e.setQueue([a, b, c], 0);
    await settle(); // a failed, b preloaded: of b's neighbours, neither a nor c is cached
    net.routes[url("a")] = 2100;
    const before = net.calls.length;
    e.next();
    await settle();
    expect(e.getState()).toMatchObject({ current: { id: "b" }, queueIndex: 1 });
    expect(net.calls.slice(before)).toEqual([url("c"), url("a")]);
  });
  it("setQueue made while another item loads waits for it, and then preloads only the start item", async () => {
    const { e, net } = setup();
    net.hold(url("x"));
    void e.play(x);
    await settle();
    e.setQueue([a, b, c], 1);
    await settle();
    expect(net.calls).toEqual([url("x")]); // nothing competes with the item being waited for
    net.release(url("x"));
    await settle();
    expect(e.getState()).toMatchObject({ status: "playing", current: { id: "x" } });
    // x is not in the queue, so its neighbours are not b's.
    expect(net.calls).toEqual([url("x"), url("b")]);
  });
  it("an item played from outside the queue while the start item loads stops the queue's neighbours", async () => {
    const { e, net } = setup();
    net.hold(url("b"));
    e.setQueue([a, b, c], 1);
    await settle();
    await e.play(x);
    net.release(url("b"));
    await settle();
    expect(net.calls).not.toContain(url("c"));
    expect(net.calls).not.toContain(url("a"));
  });
  it("a neighbour that fails to fetch or decode after unlock is silent and changes nothing", async () => {
    const { e, net, ctx } = setup({ [url("a")]: "network-error", [url("c")]: 2345 });
    ctx.failDecode.add(2345);
    await e.unlock();
    const fn = vi.fn();
    e.setQueue([a, b, c], 1);
    e.subscribe(fn);
    await settle();
    expect(net.calls).toEqual([url("b"), url("c"), url("a")]);
    expect(ctx.decodeCalls).toBe(2); // b, and c's failed decode
    expect(fn).not.toHaveBeenCalled();
    expect(e.getState().status).toBe("idle");
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
