import type { AudioBufferLike, AudioContextLike, FetchLike } from "./web-audio.ts";

export interface LoaderLimits {
  /** Decoded PCM kept, in bytes; least recently used goes first. */
  maxDecodedBytes?: number;
  /** Fetched-but-not-decoded downloads kept; oldest goes first. */
  maxPrefetched?: number;
}

/** About 30 eight-second stereo loops at 48 kHz: enough for a page of results and its neighbours. */
const DEFAULT_MAX_DECODED_BYTES = 96 * 1024 * 1024;
const DEFAULT_MAX_PREFETCHED = 32;

const pcmBytes = (b: AudioBufferLike) => b.length * b.numberOfChannels * 4;

/**
 * Fetches and decodes previews, once per URL. Bytes can be fetched before the audio context exists
 * (preload on hover, before the first gesture); decoding waits for the context. A failure is never
 * cached, so the next load of that URL starts again from the network. Memory is bounded: decoded
 * buffers by bytes, waiting downloads by count, least recently used out first. An evicted item simply
 * loads again.
 */
export class BufferLoader {
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private decoded = new Map<string, Promise<AudioBufferLike>>();
  /** PCM size of each decoded entry that has resolved. */
  private sizes = new Map<string, number>();
  private readonly maxDecodedBytes: number;
  private readonly maxPrefetched: number;

  constructor(
    private readonly fetch: FetchLike,
    limits: LoaderLimits = {},
  ) {
    this.maxDecodedBytes = limits.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
    this.maxPrefetched = limits.maxPrefetched ?? DEFAULT_MAX_PREFETCHED;
  }

  /** Start fetching without decoding. Resolves when the bytes are in or have failed; never rejects. */
  prefetch(url: string): Promise<void> {
    if (this.decoded.has(url)) return Promise.resolve();
    return this.fetchBytes(url).then(
      () => undefined,
      () => undefined,
    );
  }

  load(url: string, ctx: AudioContextLike): Promise<AudioBufferLike> {
    let p = this.decoded.get(url);
    if (p) {
      // Most recently used goes to the back of the eviction order.
      this.decoded.delete(url);
      this.decoded.set(url, p);
      return p;
    }
    p = this.fetchBytes(url)
      .then((data) => {
        // decodeAudioData detaches the buffer, so the bytes are spent either way.
        this.bytes.delete(url);
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

  /** Drops the least recently used decoded buffers until under budget, never `keep`. */
  private evict(keep: string) {
    let total = 0;
    for (const n of this.sizes.values()) total += n;
    for (const url of this.decoded.keys()) {
      if (total <= this.maxDecodedBytes) break;
      const size = this.sizes.get(url);
      if (url === keep || size === undefined) continue; // still decoding, or the one just made
      this.decoded.delete(url);
      this.sizes.delete(url);
      total -= size;
    }
  }

  private fetchBytes(url: string): Promise<ArrayBuffer> {
    let p = this.bytes.get(url);
    if (!p) {
      p = (async () => {
        const res = await this.fetch(url);
        if (!res.ok) throw new Error(`Preview request failed with HTTP ${res.status}`);
        return res.arrayBuffer();
      })().catch((err: unknown) => {
        if (this.bytes.get(url) === p) this.bytes.delete(url);
        throw err;
      });
      this.bytes.set(url, p);
      while (this.bytes.size > this.maxPrefetched) {
        const oldest = this.bytes.keys().next().value!;
        this.bytes.delete(oldest);
      }
    }
    return p;
  }
}
