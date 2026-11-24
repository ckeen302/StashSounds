import { describe, expect, it } from "vitest";
import { BufferLoader } from "../src/loader.ts";
import { FakeContext, fakeFetch, flush } from "./fake-audio.ts";

const A = "https://cdn.example.com/a.mp3";

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
});
