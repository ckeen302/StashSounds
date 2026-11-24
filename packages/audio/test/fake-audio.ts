import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BufferSourceLike,
  ContextState,
  FetchLike,
  GainNodeLike,
  StretchChange,
  StretchNodeLike,
} from "../src/web-audio.ts";

/** A decoded buffer whose sample i on channel c is c * 1e6 + i, so layouts can be checked exactly. */
export class FakeBuffer implements AudioBufferLike {
  readonly numberOfChannels = 2;
  private data: Float32Array[] | null = null;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    this.data ??= [0, 1].map((ch) => Float32Array.from({ length: this.length }, (_, i) => ch * 1e6 + i));
    return this.data[c]!;
  }
}

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

  failCreateGain = 0; // number of createGain calls that throw
  createGain(): GainNodeLike {
    if (this.failCreateGain > 0) {
      this.failCreateGain--;
      throw new DOMException("cannot create gain", "NotSupportedError");
    }
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
    return new FakeBuffer(Math.round(duration * this.sampleRate), this.sampleRate);
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

/** Like a browser AudioParam, rejects non-finite numbers with a TypeError. */
function finite(...xs: number[]) {
  for (const x of xs) if (!Number.isFinite(x)) throw new TypeError("The provided float value is non-finite.");
}

export class FakeParam implements AudioParamLike {
  private v = 1;
  /** The value before any automation, as set through `value`. */
  private base = 1;
  events: { type: string; value: number; time: number; timeConstant?: number }[] = [];
  get value() {
    return this.v;
  }
  set value(x: number) {
    finite(x);
    this.v = x;
    if (!this.events.length) this.base = x;
  }
  setValueAtTime(value: number, time: number) {
    finite(value, time);
    this.v = value;
    this.events.push({ type: "set", value, time });
  }
  setTargetAtTime(value: number, time: number, timeConstant: number) {
    finite(value, time, timeConstant);
    this.v = value;
    this.events.push({ type: "target", value, time, timeConstant });
  }
  /**
   * The value the browser would compute at time t from the automation as it now stands: a cancel
   * removes the events at or after its time that came before it; events then apply in time order.
   */
  at(t: number): number {
    let kept: { type: string; value: number; time: number; timeConstant?: number }[] = [];
    for (const e of this.events) {
      if (e.type === "cancel") kept = kept.filter((k) => k.time < e.time);
      else kept.push(e);
    }
    kept.sort((a, b) => a.time - b.time); // stable: same-time events keep their order
    let from = this.base;
    let curve: { t0: number; target: number; tau: number } | null = null;
    const valueAt = (time: number) => (curve ? curve.target + (from - curve.target) * Math.exp(-(time - curve.t0) / curve.tau) : from);
    for (const e of kept) {
      if (e.time > t) break;
      if (e.type === "set") {
        from = e.value;
        curve = null;
      } else {
        from = valueAt(e.time);
        curve = { t0: e.time, target: e.value, tau: e.timeConstant! };
      }
    }
    return valueAt(t);
  }
  cancelScheduledValues(time: number) {
    finite(time);
    this.events.push({ type: "cancel", value: this.v, time });
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

/**
 * Fake fetch: each URL maps to an audio length in ms, or an HTTP status, or a network error. Like the
 * browser's, a held request rejects with an AbortError when its signal aborts.
 */
export function fakeFetch(routes: Record<string, number | { status: number } | "network-error">) {
  const calls: string[] = [];
  const inits: Parameters<FetchLike>[1][] = [];
  /** URLs whose request was aborted while in flight. */
  const aborted: string[] = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  const pending = new Map<string, () => void>();
  const gate = { hold: new Set<string>() };
  const fn: FetchLike = async (url, init) => {
    calls.push(url);
    inits.push(init);
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    let open = true;
    const close = () => {
      if (open) stats.inFlight--;
      open = false;
    };
    try {
      const signal = init?.signal;
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      if (gate.hold.has(url)) {
        await new Promise<void>((resolve, reject) => {
          pending.set(url, resolve);
          signal?.addEventListener("abort", () => {
            aborted.push(url);
            close(); // the browser cancels the request at abort(), not when its promise settles
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }
      const route = routes[url];
      if (route === undefined || route === "network-error") throw new TypeError("Failed to fetch");
      if (typeof route === "object") return { ok: false, status: route.status, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(route) };
    } finally {
      close();
    }
  };
  /** Hold a URL's response until release(url). */
  const hold = (url: string) => gate.hold.add(url);
  const release = (url: string) => {
    gate.hold.delete(url);
    pending.get(url)?.();
    pending.delete(url);
  };
  return { fetch: fn, calls, inits, aborted, stats, hold, release, routes };
}

/** A fake Signalsmith Stretch node: records what the engine asks of it. */
export class FakeStretch implements StretchNodeLike {
  schedules: StretchChange[] = [];
  buffers: Float32Array[][] = [];
  drops = 0;
  connected: AudioNodeLike[] = [];
  latencySeconds = 0.12;
  /** latency() rejects while set, as a worklet that failed to start would. */
  failLatency = false;
  disconnects = 0;
  connect(d: AudioNodeLike) {
    this.connected.push(d);
  }
  disconnect() {
    this.disconnects++;
    this.connected = [];
  }
  async addBuffers(channels: Float32Array[]): Promise<number> {
    this.buffers.push(channels);
    return channels[0]!.length;
  }
  async dropBuffers() {
    this.drops++;
    this.buffers = [];
    return { start: 0, end: 0 };
  }
  async schedule(change: StretchChange) {
    this.schedules.push({ ...change });
    return change;
  }
  async latency() {
    if (this.failLatency) throw new Error("the worklet did not answer");
    return this.latencySeconds;
  }
  /** The last schedule that started playback. */
  get lastStart(): StretchChange | undefined {
    return this.schedules.filter((s) => s.active === true).at(-1);
  }
}

/** A stretch loader the test controls: counts calls, can fail, can be held. */
export function fakeStretchLoader() {
  const node = new FakeStretch();
  const state = { calls: 0, fail: false, held: null as null | (() => void) };
  let hold = false;
  const load = async (_ctx: AudioContextLike): Promise<StretchNodeLike> => {
    state.calls++;
    if (hold) await new Promise<void>((r) => (state.held = r));
    if (state.fail) throw new Error("stretch failed to load");
    return node;
  };
  return {
    node,
    load,
    state,
    hold: () => (hold = true),
    release: () => {
      hold = false;
      state.held?.();
    },
  };
}

/** Let queued promise callbacks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
