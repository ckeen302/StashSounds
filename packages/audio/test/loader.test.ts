import { describe, expect, it } from "vitest";
import { BufferLoader } from "../src/loader.ts";
import { FakeContext, fakeFetch, flush } from "./fake-audio.ts";

const A = "https://cdn.example.com/a.mp3";
const B = "https://cdn.example.com/b.mp3";
const C = "https://cdn.example.com/c.mp3";
// FakeContext decodes n bytes into n ms of stereo audio at 48 kHz: 2000 bytes -> 96000 frames x 2 x 4 = 768000 bytes of PCM.
const PCM_2S = 96000 * 2 * 4;

describe("BufferLoader", () => {
  it("fetches once per URL and decodes once per URL", async () => {
    const net = fakeFetch({ [A]: 2000 });
    const ctx = new FakeContext();
    const loader = new BufferLoader(net.fetch);
    const [b1, b2] = await Promise.all([loader.load(A, ctx), loader.load(A, ctx)]);
    expect(b1).toBe(b2);
    expect(await loader.load(A, ctx)).toBe(b1);
    expect(net.calls).toEqual([A]);
    expect(ctx.decodeCalls).toBe(1);
  });

  it("prefetches bytes without a context and decodes them later without refetching", async () => {
    const net = fakeFetch({ [A]: 2000 });
    const loader = new BufferLoader(net.fetch);
    loader.prefetch(A);
    await flush();
    expect(net.calls).toEqual([A]);
    const ctx = new FakeContext();
    const buf = await loader.load(A, ctx);
    expect(buf.duration).toBe(2);
    expect(net.calls).toEqual([A]);
  });

  it("rejects on an HTTP error and does not cache the failure", async () => {
    const net = fakeFetch({ [A]: { status: 503 } });
    const ctx = new FakeContext();
    const loader = new BufferLoader(net.fetch);
    await expect(loader.load(A, ctx)).rejects.toThrow(/503/);
    net.routes[A] = 2000;
    await expect(loader.load(A, ctx)).resolves.toMatchObject({ duration: 2 });
    expect(net.calls).toEqual([A, A]);
  });

  it("does not cache a failed decode (the bytes are fetched again on retry)", async () => {
    const net = fakeFetch({ [A]: 1234 });
    const ctx = new FakeContext();
    ctx.failDecode.add(1234);
    const loader = new BufferLoader(net.fetch);
    await expect(loader.load(A, ctx)).rejects.toThrow();
    ctx.failDecode.clear();
    await expect(loader.load(A, ctx)).resolves.toBeTruthy();
    expect(net.calls).toEqual([A, A]);
  });

  it("swallows a failed prefetch so nothing reaches the UI", async () => {
    const net = fakeFetch({ [A]: "network-error" });
    const loader = new BufferLoader(net.fetch);
    expect(() => loader.prefetch(A)).not.toThrow();
    await flush();
    net.routes[A] = 2000;
    await expect(loader.load(A, new FakeContext())).resolves.toBeTruthy();
  });

  it("prefetch resolves, never rejects, once the bytes are in or have failed", async () => {
    const net = fakeFetch({ [A]: 2000, [B]: "network-error" });
    const loader = new BufferLoader(net.fetch);
    await expect(loader.prefetch(A)).resolves.toBeUndefined();
    await expect(loader.prefetch(B)).resolves.toBeUndefined();
  });

  it("evicts the least recently used decoded buffer once past the byte budget", async () => {
    const net = fakeFetch({ [A]: 2000, [B]: 2000, [C]: 2000 });
    const ctx = new FakeContext();
    const loader = new BufferLoader(net.fetch, { maxDecodedBytes: 2 * PCM_2S });
    await loader.load(A, ctx);
    await loader.load(B, ctx);
    await loader.load(A, ctx); // A is now the most recent
    await loader.load(C, ctx); // over budget: B goes
    expect(net.calls).toEqual([A, B, C]);
    await loader.load(A, ctx);
    expect(net.calls).toEqual([A, B, C]);
    await loader.load(B, ctx);
    expect(net.calls).toEqual([A, B, C, B]);
  });

  it("keeps the buffer it just decoded even when it alone is over budget", async () => {
    const net = fakeFetch({ [A]: 2000, [B]: 2000 });
    const ctx = new FakeContext();
    const loader = new BufferLoader(net.fetch, { maxDecodedBytes: 10 });
    const a = await loader.load(A, ctx);
    expect(await loader.load(A, ctx)).toBe(a);
    await loader.load(B, ctx);
    await loader.load(A, ctx);
    expect(net.calls).toEqual([A, B, A]);
  });

  it("keeps at most maxPrefetched undecoded downloads, dropping the oldest", async () => {
    const net = fakeFetch({ [A]: 2000, [B]: 2000, [C]: 2000 });
    const loader = new BufferLoader(net.fetch, { maxPrefetched: 2 });
    await loader.prefetch(A);
    await loader.prefetch(B);
    await loader.prefetch(C);
    const ctx = new FakeContext();
    await loader.load(C, ctx);
    await loader.load(B, ctx);
    expect(net.calls).toEqual([A, B, C]);
    await loader.load(A, ctx);
    expect(net.calls).toEqual([A, B, C, A]);
  });
});
