import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BufferSourceLike,
  ContextState,
  FetchLike,
  GainNodeLike,
} from "../src/web-audio.ts";

/** A fake AudioContext whose clock only moves when a test calls advance(). */
export class FakeContext implements AudioContextLike {
  currentTime = 0;
  state: ContextState = "suspended";
  destination: AudioNodeLike = { connect: () => undefined, disconnect: () => undefined };
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resumeCalls = 0;
  failResume = false;
  failDecode = new Set<number>(); // byteLength values that decode with an error
  decodeCalls = 0;
  sampleRate = 48000;

  createGain(): GainNodeLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource(): BufferSourceLike {
    const s = new FakeSource(this);
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    this.decodeCalls++;
    if (this.failDecode.has(data.byteLength)) throw new DOMException("Unable to decode audio data", "EncodingError");
    // Fixture convention: byteLength is the length in milliseconds of audio.
    const duration = data.byteLength / 1000;
    return { duration, sampleRate: this.sampleRate, length: Math.round(duration * this.sampleRate) };
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    if (this.failResume) throw new DOMException("not allowed", "NotAllowedError");
    this.state = "running";
  }
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const s of this.sources) s.tick();
  }
  /** Sources started and not stopped. */
  get playing(): FakeSource[] {
    return this.sources.filter((s) => s.startedAt !== null && s.stoppedAt === null);
  }
}

export class FakeParam implements AudioParamLike {
  value = 1;
  events: { type: string; value: number; time: number }[] = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ type: "set", value, time });
  }
  setTargetAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ type: "target", value, time });
  }
  cancelScheduledValues(time: number) {
    this.events.push({ type: "cancel", value: this.value, time });
  }
}

export class FakeGain implements GainNodeLike {
  gain = new FakeParam();
  connected: AudioNodeLike[] = [];
  connect(d: AudioNodeLike) {
    this.connected.push(d);
  }
  disconnect() {
    this.connected = [];
  }
}

export class FakeSource implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: ((ev: Event) => unknown) | null = null;
  startedAt: number | null = null;
  startOffset = 0;
  stoppedAt: number | null = null;
  connected: AudioNodeLike[] = [];
  private ended = false;
  constructor(private ctx: FakeContext) {}
  connect(d: AudioNodeLike) {
    this.connected.push(d);
  }
  disconnect() {
    this.connected = [];
  }
  start(when = 0, offset = 0) {
    if (this.startedAt !== null) throw new DOMException("start called twice", "InvalidStateError");
    this.startedAt = Math.max(when, this.ctx.currentTime);
    this.startOffset = offset;
  }
  stop(when = 0) {
    this.stoppedAt = Math.max(when, this.ctx.currentTime);
  }
  /** Fires onended once the buffer runs out (non-looping) or once stopped. */
  tick() {
    if (this.ended || this.startedAt === null) return;
    const t = this.ctx.currentTime;
    const naturalEnd = !this.loop && this.buffer ? this.startedAt + (this.buffer.duration - this.startOffset) : Infinity;
    const end = Math.min(naturalEnd, this.stoppedAt ?? Infinity);
    if (t >= end) {
      this.ended = true;
      this.onended?.(new Event("ended"));
    }
  }
}

/** Fake fetch: each URL maps to an audio length in ms, or an HTTP status, or a network error. */
export function fakeFetch(routes: Record<string, number | { status: number } | "network-error">) {
  const calls: string[] = [];
  const pending = new Map<string, () => void>();
  const gate = { hold: new Set<string>() };
  const fn: FetchLike = async (url) => {
    calls.push(url);
    if (gate.hold.has(url)) await new Promise<void>((r) => pending.set(url, r));
    const route = routes[url];
    if (route === undefined || route === "network-error") throw new TypeError("Failed to fetch");
    if (typeof route === "object") return { ok: false, status: route.status, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(route) };
  };
  /** Hold a URL's response until release(url). */
  const hold = (url: string) => gate.hold.add(url);
  const release = (url: string) => {
    gate.hold.delete(url);
    pending.get(url)?.();
    pending.delete(url);
  };
  return { fetch: fn, calls, hold, release, routes };
}

/** Let queued promise callbacks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
