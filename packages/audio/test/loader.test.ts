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

  it("fetches without credentials and with an abort signal", async () => {
    const net = fakeFetch({ [A]: 2000 });
    const loader = new BufferLoader(net.fetch);
    await loader.load(A, new FakeContext());
    expect(net.inits[0]).toMatchObject({ credentials: "omit" });
    expect(net.inits[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses any scheme but https, and http except on 127.0.0.1 and localhost, without a request", async () => {
    const refused = [
      "http://cdn.example.com/a.mp3",
      "http://127.0.0.2/a.mp3",
      "http://localhost.example.com/a.mp3",
      "ftp://cdn.example.com/a.mp3",
      "data:audio/mpeg;base64,AAAA",
      "blob:https://stash.example/0d1e",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "/relative/a.mp3",
      "not a url",
    ];
    const allowed = ["https://cdn.example.com/a.mp3", "http://127.0.0.1:4173/fixtures/a.mp3", "http://localhost:3000/a.mp3"];
    const net = fakeFetch(Object.fromEntries([...refused, ...allowed].map((u) => [u, 2000])));
    const loader = new BufferLoader(net.fetch);
    const ctx = new FakeContext();
    for (const u of refused) await expect(loader.load(u, ctx), u).rejects.toThrow(/https/);
    for (const u of refused) await expect(loader.prefetch(u)).resolves.toBeUndefined();
    expect(net.calls).toEqual([]);
    for (const u of allowed) await expect(loader.load(u, ctx), u).resolves.toBeTruthy();
    expect(net.calls).toEqual(allowed);
  });

  const many = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.example.com/${i}.mp3`);

  it("runs at most four background downloads at once, the newest waiting one next", async () => {
    const urls = many(8);
    const net = fakeFetch(Object.fromEntries(urls.map((u) => [u, 2000])));
    for (const u of urls) net.hold(u);
    const loader = new BufferLoader(net.fetch);
    for (const u of urls) void loader.prefetch(u);
    await flush();
    expect(net.calls).toEqual(urls.slice(0, 4));
    net.release(urls[0]!);
    await flush();
    expect(net.calls.at(-1)).toBe(urls[7]); // newest first: the one the person reached last
    for (const u of urls) net.release(u);
    for (let i = 0; i < 5; i++) await flush();
    expect(net.stats.maxInFlight).toBe(4);
    expect([...net.calls].sort()).toEqual([...urls].sort());
  });

  it("a foreground load starts at once when the background slots are full, and takes over a waiting download", async () => {
    const urls = many(6);
    const net = fakeFetch(Object.fromEntries(urls.map((u) => [u, 2000])));
    for (const u of urls) net.hold(u);
    const loader = new BufferLoader(net.fetch);
    for (const u of urls.slice(0, 5)) void loader.prefetch(u);
    await flush();
    expect(net.calls).toEqual(urls.slice(0, 4)); // 4 waits
    const ctx = new FakeContext();
    const now = loader.load(urls[4]!, ctx); // the waiting one, now wanted
    const other = loader.load(urls[5]!, ctx);
    await flush();
    expect(net.calls).toEqual(urls);
    net.release(urls[4]!);
    net.release(urls[5]!);
    await expect(now).resolves.toBeTruthy();
    await expect(other).resolves.toBeTruthy();
  });

  it("a download dropped from the cap is aborted if in flight, and never starts if waiting", async () => {
    const urls = many(8);
    const net = fakeFetch(Object.fromEntries(urls.map((u) => [u, 2000])));
    for (const u of urls) net.hold(u);
    const loader = new BufferLoader(net.fetch, { maxPrefetched: 4, maxBackground: 2 });
    const done: Promise<void>[] = [];
    for (const u of urls) {
      done.push(loader.prefetch(u)); // one hover at a time
      await flush();
    }
    // 0, 1 start and 2, 3 wait. Each later hover drops the oldest: 0 and 1 are aborted (their slots go
    // to 4 and 5, the newest), then 2 and 3 are dropped before they ever start.
    expect([...net.aborted].sort()).toEqual([urls[0], urls[1]].sort());
    expect(net.calls).toEqual([urls[0], urls[1], urls[4], urls[5]]);
    await Promise.all(done.slice(0, 4)); // dropped ones resolve: prefetch never rejects
    for (const u of urls) net.release(u);
    await Promise.all(done);
    expect(net.calls).toEqual([urls[0], urls[1], urls[4], urls[5], urls[7], urls[6]]);
    expect(net.stats.maxInFlight).toBe(2);
  });

  it("the cap never drops a foreground download in flight", async () => {
    const urls = many(4);
    const net = fakeFetch(Object.fromEntries(urls.map((u) => [u, 2000])));
    net.hold(urls[0]!);
    const loader = new BufferLoader(net.fetch, { maxPrefetched: 2 });
    const ctx = new FakeContext();
    const playing = loader.load(urls[0]!, ctx);
    for (const u of urls.slice(1)) await loader.prefetch(u);
    expect(net.aborted).toEqual([]);
    net.release(urls[0]!);
    await expect(playing).resolves.toBeTruthy();
  });

  it("cancel aborts a download in flight, and a later load fetches again", async () => {
    const net = fakeFetch({ [A]: 2000 });
    net.hold(A);
    const loader = new BufferLoader(net.fetch);
    const ctx = new FakeContext();
    const first = loader.load(A, ctx);
    await flush();
    loader.cancel(A);
    await expect(first).rejects.toThrow(/abort/i);
    expect(net.aborted).toEqual([A]);
    net.release(A);
    await expect(loader.load(A, ctx)).resolves.toBeTruthy();
    expect(net.calls).toEqual([A, A]);
  });

  it("cancel leaves a decoded buffer alone", async () => {
    const net = fakeFetch({ [A]: 2000 });
    const loader = new BufferLoader(net.fetch);
    const ctx = new FakeContext();
    const a = await loader.load(A, ctx);
    loader.cancel(A);
    expect(await loader.load(A, ctx)).toBe(a);
    expect(net.calls).toEqual([A]);
  });

  it("never evicts the pinned URL, so the playing item is never decoded twice", async () => {
    const net = fakeFetch({ [A]: 2000, [B]: 2000, [C]: 2000 });
    const ctx = new FakeContext();
    const loader = new BufferLoader(net.fetch, { maxDecodedBytes: 2 * PCM_2S });
    loader.pin(A);
    await loader.load(A, ctx); // the oldest
    await loader.load(B, ctx);
    await loader.load(C, ctx); // over budget: B goes, not the pinned A
    await loader.load(A, ctx);
    expect(net.calls).toEqual([A, B, C]);
    expect(ctx.decodeCalls).toBe(3);
    loader.pin(null);
    await loader.load(B, ctx); // over budget again: C, the least recently used, goes
    await loader.load(A, ctx);
    expect(net.calls).toEqual([A, B, C, B]);
    await loader.load(C, ctx);
    expect(net.calls).toEqual([A, B, C, B, C]);
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
