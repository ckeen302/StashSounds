import type { AudioBufferLike, AudioContextLike, FetchLike } from "./web-audio.ts";

/**
 * Fetches and decodes previews, once per URL. Bytes can be fetched before the audio context exists
 * (preload on hover, before the first gesture); decoding waits for the context. A failure is never
 * cached, so the next load of that URL starts again from the network.
 */
export class BufferLoader {
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private decoded = new Map<string, Promise<AudioBufferLike>>();

  constructor(private readonly fetch: FetchLike) {}

  /** Start fetching without decoding. Never throws or rejects. */
  prefetch(url: string): void {
    if (this.decoded.has(url)) return;
    this.fetchBytes(url).catch(() => undefined);
  }

  load(url: string, ctx: AudioContextLike): Promise<AudioBufferLike> {
    let p = this.decoded.get(url);
    if (!p) {
      p = this.fetchBytes(url)
        .then((data) => {
          // decodeAudioData detaches the buffer, so the bytes are spent either way.
          this.bytes.delete(url);
          return ctx.decodeAudioData(data);
        })
        .catch((err: unknown) => {
          this.decoded.delete(url);
          throw err;
        });
      this.decoded.set(url, p);
    }
    return p;
  }

  private fetchBytes(url: string): Promise<ArrayBuffer> {
    let p = this.bytes.get(url);
    if (!p) {
      p = (async () => {
        const res = await this.fetch(url);
        if (!res.ok) throw new Error(`Preview request failed with HTTP ${res.status}`);
        return res.arrayBuffer();
      })().catch((err: unknown) => {
        this.bytes.delete(url);
        throw err;
      });
      this.bytes.set(url, p);
    }
    return p;
  }
}
