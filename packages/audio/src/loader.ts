import type { AudioBufferLike, AudioContextLike, FetchLike } from "./web-audio.ts";

export interface LoaderLimits {
  /** Decoded PCM kept, in bytes; least recently used goes first. */
  maxDecodedBytes?: number;
  /** Downloads kept that are not decoded yet (in flight, waiting, or fetched before the context); oldest goes first. */
  maxPrefetched?: number;
  /** Background downloads (hover, neighbours) in flight at once. */
  maxBackground?: number;
}

/** Whether a download is for the item the person is waiting for, or ahead of time. */
export type Priority = "now" | "background";

/** About 30 eight-second stereo loops at 48 kHz: enough for a page of results and its neighbours. */
const DEFAULT_MAX_DECODED_BYTES = 96 * 1024 * 1024;
const DEFAULT_MAX_PREFETCHED = 32;
const DEFAULT_MAX_BACKGROUND = 4;

const pcmBytes = (b: AudioBufferLike) => b.length * b.numberOfChannels * 4;

/**
 * Previews come from the public bucket over https. Plain http is allowed only on this machine (the
 * audio test page and local development); every other scheme is refused before any request.
 */
export function isAllowedPreviewUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
}

const abortError = () => new DOMException("The preview download was aborted.", "AbortError");

interface Download {
  bytes: Promise<ArrayBuffer>;
  controller: AbortController;
  /** Started: the request is out (or done). Until then it waits for a background slot. */
  started: boolean;
  settled: boolean;
  /** Started as, or taken over by, a load for the item being waited for: never dropped by the cap. */
  now: boolean;
  /** Holds a background slot until it settles. */
  slot: boolean;
  start: () => void;
  fail: (err: unknown) => void;
}

/**
 * Fetches and decodes previews, once per URL. Bytes can be fetched before the audio context exists
 * (preload on hover, before the first gesture); decoding waits for the context. A failure is never
 * cached, so the next load of that URL starts again from the network.
 *
 * Background downloads (hover, neighbours) run a few at a time, the most recently asked for first;
 * a download for the item being waited for starts at once. Memory is bounded: decoded buffers by bytes
 * and undecoded downloads by count, least recently used out. A download dropped while in flight is
 * aborted. The pinned URL (the item playing) is never dropped. An evicted item simply loads again.
 */
export class BufferLoader {
  private downloads = new Map<string, Download>();
  /** Background downloads waiting for a slot, oldest first; the newest starts next. */
  private waiting: string[] = [];
  private running = 0;
  private decoded = new Map<string, Promise<AudioBufferLike>>();
  /** PCM size of each decoded entry that has resolved. */
  private sizes = new Map<string, number>();
  private pinned: string | null = null;
  private readonly maxDecodedBytes: number;
  private readonly maxPrefetched: number;
  private readonly maxBackground: number;

  constructor(
    private readonly fetch: FetchLike,
    limits: LoaderLimits = {},
  ) {
    this.maxDecodedBytes = limits.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
    this.maxPrefetched = limits.maxPrefetched ?? DEFAULT_MAX_PREFETCHED;
    this.maxBackground = limits.maxBackground ?? DEFAULT_MAX_BACKGROUND;
  }

  /** Start fetching without decoding. Resolves when the bytes are in, have failed or were dropped; never rejects. */
  prefetch(url: string, priority: Priority = "background"): Promise<void> {
    if (this.decoded.has(url)) return Promise.resolve();
    return this.fetchBytes(url, priority).then(
      () => undefined,
      () => undefined,
    );
  }

  load(url: string, ctx: AudioContextLike, priority: Priority = "now"): Promise<AudioBufferLike> {
    let p = this.decoded.get(url);
    if (p) {
      // Most recently used goes to the back of the eviction order.
      this.decoded.delete(url);
      this.decoded.set(url, p);
      // Still downloading in the background, and now wanted at once: take it out of the queue.
      if (priority === "now") this.promote(url);
      return p;
    }
    const download = this.fetchBytes(url, priority);
    p = download
      .then((data) => {
        // decodeAudioData detaches the buffer, so the bytes are spent either way.
        this.forget(url);
        return ctx.decodeAudioData(data);
      })
      .then((buffer) => {
        if (this.decoded.get(url) === p) {
          this.sizes.set(url, pcmBytes(buffer));
          this.evict(url);
        }
        return buffer;
      })
      .catch((err: unknown) => {
        if (this.decoded.get(url) === p) this.decoded.delete(url);
        throw err;
      });
    this.decoded.set(url, p);
    return p;
  }

  /** The URL of the item playing (or null): never evicted, never dropped, so it is never decoded twice. */
  pin(url: string | null): void {
    this.pinned = url;
  }

  /** Abandons a download nobody waits for any more (the person moved on). A decoded buffer is kept. */
  cancel(url: string): void {
    const d = this.downloads.get(url);
    if (!d || d.settled) return;
    this.drop(url, d);
  }

  /** Drops the least recently used decoded buffers until under budget, never `keep` or the pinned URL. */
  private evict(keep: string) {
    let total = 0;
    for (const n of this.sizes.values()) total += n;
    for (const url of this.decoded.keys()) {
      if (total <= this.maxDecodedBytes) break;
      const size = this.sizes.get(url);
      if (url === keep || url === this.pinned || size === undefined) continue; // kept, or still decoding
      this.decoded.delete(url);
      this.sizes.delete(url);
      total -= size;
    }
  }

  private fetchBytes(url: string, priority: Priority): Promise<ArrayBuffer> {
    const existing = this.downloads.get(url);
    if (existing) {
      if (priority === "now") this.promote(url);
      return existing.bytes;
    }
    if (!isAllowedPreviewUrl(url)) {
      return Promise.reject(new Error("Preview URL refused: previews load over https (http only on localhost)"));
    }
    const controller = new AbortController();
    let resolve!: (b: ArrayBuffer) => void;
    let reject!: (err: unknown) => void;
    const bytes = new Promise<ArrayBuffer>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    bytes.catch(() => undefined); // a dropped download nobody awaits is not an unhandled rejection
    const d: Download = {
      bytes,
      controller,
      started: false,
      settled: false,
      now: priority === "now",
      slot: false,
      start: () => {
        if (d.started) return;
        d.started = true;
        void (async () => {
          const res = await this.fetch(url, { credentials: "omit", signal: controller.signal });
          if (!res.ok) throw new Error(`Preview request failed with HTTP ${res.status}`);
          return res.arrayBuffer();
        })().then(
          (b) => {
            if (d.settled) return;
            d.settled = true;
            this.release(d);
            resolve(b);
          },
          (err: unknown) => d.fail(err),
        );
      },
      fail: (err) => {
        if (d.settled) return;
        d.settled = true;
        this.release(d);
        if (this.downloads.get(url) === d) this.downloads.delete(url);
        reject(err);
      },
    };
    this.downloads.set(url, d);
    if (d.now) d.start();
    else this.waiting.push(url);
    this.trim();
    this.pump();
    return bytes;
  }

  /** A waiting or background download is now wanted at once: it leaves the queue and the cap's reach. */
  private promote(url: string) {
    const d = this.downloads.get(url);
    if (!d || d.now) return;
    d.now = true;
    if (!d.started) {
      this.waiting = this.waiting.filter((u) => u !== url);
      d.start();
    }
  }

  /** Starts waiting background downloads while slots are free, newest first. */
  private pump() {
    while (this.running < this.maxBackground && this.waiting.length) {
      const url = this.waiting.pop()!;
      const d = this.downloads.get(url);
      if (!d || d.started) continue;
      d.slot = true;
      this.running++;
      d.start();
    }
  }

  private release(d: Download) {
    if (!d.slot) return;
    d.slot = false;
    this.running--;
    queueMicrotask(() => this.pump());
  }

  /** Keeps at most maxPrefetched downloads, dropping the oldest that nobody is waiting on. */
  private trim() {
    for (const [url, d] of this.downloads) {
      if (this.downloads.size <= this.maxPrefetched) break;
      if ((d.now && !d.settled) || url === this.pinned) continue;
      this.drop(url, d);
    }
  }

  /** Forgets a download, aborting it if in flight. Its promise rejects with an AbortError. */
  private drop(url: string, d: Download) {
    if (this.downloads.get(url) === d) this.downloads.delete(url);
    this.waiting = this.waiting.filter((u) => u !== url);
    if (d.started && !d.settled) d.controller.abort();
    d.fail(abortError());
  }

  /** The bytes were handed to the decoder: nothing left to keep. */
  private forget(url: string) {
    this.downloads.delete(url);
  }
}
