import limits from "@stash/contracts/limits.json" with { type: "json" };
import { BufferLoader } from "./loader.ts";
import { loopFrames, paddedLoop } from "./loop-layout.ts";
import type { Engine, EngineState, Playable, SoundId } from "./types.ts";
import { createBrowserContext, createBrowserStretch } from "./web-audio.ts";
import type { AudioBufferLike, AudioContextLike, BufferSourceLike, FetchLike, GainNodeLike, StretchNodeLike } from "./web-audio.ts";

export const INITIAL_STATE: EngineState = {
  status: "idle",
  current: null,
  durationMs: 0,
  tempoRatio: 1,
  transpose: 0,
  volume: 0.8,
  queue: [],
  queueIndex: -1,
};

/** Time constant of the fade on stop and on a mid-file start, so neither clicks. */
const FADE_S = 0.005;
/** A voice is stopped this long after its fade starts (six time constants: below -50 dB). */
const STOP_AFTER_S = 0.03;
/** Time constant for volume changes, so dragging the slider does not zipper. */
const VOLUME_S = 0.01;
/** Scheduling margin on top of the stretch's own latency, so a change is never late. */
const LEAD_S = 0.02;
/** Minimum loop audio laid either side of the loop in the stretch's buffer (also at least 2x its latency). */
const PAD_S = 1;
/** How long the stretch may take to load, and then to answer latency(), before the loop plays on without it. */
const STRETCH_TIMEOUT_MS = 3000;

export interface EngineDeps {
  /** Called once, on the first gesture. Defaults to the browser's AudioContext. */
  createContext?: () => AudioContextLike;
  fetch?: FetchLike;
  /** Loads the time stretch the first time a loop needs it. Defaults to Signalsmith Stretch. */
  loadStretch?: (ctx: AudioContextLike) => Promise<StretchNodeLike>;
  /** Waits about this many seconds of audio clock. Defaults to a timer. */
  sleep?: (seconds: number) => Promise<void>;
  /** Wall-clock deadline for loading the stretch and for its latency() answer. Defaults to 3 s. */
  stretchTimeoutMs?: number;
}

/** A buffer source at the original tempo and key: sample-exact, no added latency. */
interface PlainVoice {
  kind: "plain";
  src: BufferSourceLike;
  gain: GainNodeLike;
}
/** The loop playing through the stretch. Not started until its first schedule is sent. */
interface StretchVoice {
  kind: "stretch";
  started: boolean;
}
type Voice = PlainVoice | StretchVoice;

/** From audio-clock time `at`, the position runs from `pos` at `rate` (seconds of item per second). */
interface Segment {
  at: number;
  pos: number;
  rate: number;
}

/** The URL of the one buffer an item plays, or null for kinds whose players come later (kit 221, MIDI 223). */
function sourceUrl(item: Playable): string | null {
  switch (item.kind) {
    case "loop":
    case "oneshot":
      return item.previewUrl;
    case "preset":
      return item.demoUrl;
    case "kit":
    case "midi":
      return null;
  }
}

/**
 * The browser engine: one AudioContext for the session, created on the first gesture. Previews are
 * fetched and decoded into buffers and played through a per-voice gain into one master gain.
 * Position comes from the audio clock and is never state. No method throws into the UI: failures set
 * status 'error', and play() retries.
 */
export class WebAudioEngine implements Engine {
  private state: EngineState = { ...INITIAL_STATE };
  private listeners = new Set<(s: EngineState) => void>();
  private readonly createContext: () => AudioContextLike;
  private readonly loadStretch: (ctx: AudioContextLike) => Promise<StretchNodeLike>;
  private readonly sleep: (seconds: number) => Promise<void>;
  private readonly stretchTimeoutMs: number;
  private readonly loader: BufferLoader;

  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private voice: Voice | null = null;
  /** Buffer of the current item, once decoded. */
  private buffer: AudioBufferLike | null = null;
  /** Loop length in seconds for loops, else null. */
  private loopS: number | null = null;
  /** Position in seconds while no voice is playing. */
  private offsetS = 0;
  /** How the playing voice's position moves on the audio clock. Empty when nothing plays. */
  private timeline: Segment[] = [];
  /** The plain voice whose handoff to the stretch is in flight, if any. */
  private handoffFor: PlainVoice | null = null;

  // The stretch: one node for the session, loaded on first need, behind its own gain.
  private stretchLoad: Promise<void> | null = null;
  private stretchNode: StretchNodeLike | null = null;
  private stretchGain: GainNodeLike | null = null;
  private stretchLatency = 0;
  /** The buffer the stretch holds, and the seconds of padding before its loop. */
  private stretchBuffer: AudioBufferLike | null = null;
  private stretchPadS = 0;
  /** Audio-clock time by which the stretch's last fade-out is silent; its buffers are swapped only after it. */
  private stretchQuietAt = 0;
  /** Buffer swaps run one at a time. */
  private stretchChain: Promise<void> = Promise.resolve();
  /** Bumped by every load, so a slow earlier load never starts after a later play. */
  private generation = 0;
  /** Whether a load in flight should start playing when it lands (pause during loading clears it). */
  private wantPlay = false;
  /** The URL of the current item while its load is in flight, and that load settling (never rejects). */
  private loadingUrl: string | null = null;
  private loading: Promise<void> = Promise.resolve();

  constructor(deps: EngineDeps = {}) {
    this.createContext = deps.createContext ?? createBrowserContext;
    this.loadStretch = deps.loadStretch ?? createBrowserStretch;
    this.sleep = deps.sleep ?? ((s) => new Promise((resolve) => setTimeout(resolve, s * 1000)));
    this.stretchTimeoutMs = deps.stretchTimeoutMs ?? STRETCH_TIMEOUT_MS;
    this.loader = new BufferLoader(deps.fetch ?? ((url, init) => globalThis.fetch(url, init)));
  }

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) {
      try {
        l(this.state);
      } catch (err) {
        console.error("[audio] a state listener threw", err);
      }
    }
  }

  private fail(err: unknown) {
    this.wantPlay = false;
    this.stopVoice();
    console.warn("[audio]", err);
    this.set({ status: "error" });
  }

  /**
   * Creates the context synchronously (so it happens inside the gesture), then resumes it. Resolves
   * false after setting status 'error' when either step fails.
   */
  private ensureRunning(): Promise<boolean> {
    try {
      // Keep the context the moment it exists, so a later throw can never leak it into a second one.
      this.ctx ??= this.createContext();
      if (!this.master) {
        const master = this.ctx.createGain();
        master.gain.value = this.state.volume;
        master.connect(this.ctx.destination);
        this.master = master;
      }
    } catch (err) {
      this.fail(err);
      return Promise.resolve(false);
    }
    const ctx = this.ctx;
    if (ctx.state === "running") return Promise.resolve(true);
    return ctx.resume().then(
      () => true,
      (err: unknown) => {
        this.fail(err);
        return false;
      },
    );
  }

  async unlock(): Promise<void> {
    await this.ensureRunning();
  }

  preload(item: Playable): void {
    void this.warm(item);
  }

  /** Fetches, and decodes once the context exists. Resolves when done or failed; never rejects. */
  private warm(item: Playable): Promise<void> {
    const url = sourceUrl(item);
    if (!url) return Promise.resolve();
    if (this.ctx) {
      return this.loader.load(url, this.ctx, "background").then(
        () => undefined,
        () => undefined,
      );
    }
    return this.loader.prefetch(url, "background");
  }

  /**
   * Preloads the queue items either side of the current index, the next one first. Called only once
   * the current item has loaded, so on a slow connection they never compete with it.
   */
  private warmNeighbours() {
    const { queue, queueIndex, current } = this.state;
    if (!current || queue[queueIndex]?.id !== current.id) return;
    for (const n of [queue[queueIndex + 1], queue[queueIndex - 1]]) if (n) void this.warm(n);
  }

  async play(item?: Playable): Promise<void> {
    try {
      await this.playInner(item);
    } catch (err) {
      this.fail(err);
    }
  }

  private async playInner(item?: Playable): Promise<void> {
    const target = item ?? this.state.current;
    if (!target) return;
    const same = target.id === this.state.current?.id;
    if (same && this.state.status === "playing") return;
    if (same && this.state.status === "loading") {
      this.wantPlay = true;
      return;
    }

    const generation = ++this.generation;
    const url = sourceUrl(target);
    if (!same) {
      // The item being replaced is not wanted any more: stop its download, and keep the new one decoded.
      if (this.loadingUrl && this.loadingUrl !== url) this.loader.cancel(this.loadingUrl);
      this.loadingUrl = null;
      this.loader.pin(url);
      this.stopVoice();
      this.buffer = null;
      this.loopS = null;
      this.offsetS = 0;
      this.wantPlay = !!url;
      this.set({ current: target, durationMs: 0, status: url ? "loading" : "idle" });
    }
    if (!url) return;

    const running = this.ensureRunning(); // context created here, synchronously, inside the gesture
    const ctx = this.ctx;
    if (!ctx || !this.master) return;

    if (same && this.buffer) {
      if (!(await running) || generation !== this.generation) return;
      this.startVoice(this.offsetS);
      this.set({ status: "playing" });
      return;
    }

    this.wantPlay = true;
    if (this.state.status !== "loading") this.set({ status: "loading" });
    let buffer: AudioBufferLike;
    let ok: boolean;
    const load = this.loader.load(url, ctx);
    this.loadingUrl = url;
    this.loading = load.then(
      () => undefined,
      () => undefined,
    );
    try {
      [ok, buffer] = await Promise.all([running, load]);
    } catch (err) {
      if (generation === this.generation) {
        this.loadingUrl = null;
        this.fail(err);
      }
      return;
    }
    if (generation !== this.generation) return;
    this.loadingUrl = null;
    if (!ok) return;

    this.buffer = buffer;
    this.loopS = target.kind === "loop" ? loopFrames(target, buffer) / buffer.sampleRate : null;
    const durationMs = (this.loopS ?? buffer.duration) * 1000;
    if (!this.wantPlay) {
      this.set({ status: "paused", durationMs });
    } else {
      this.startVoice(this.offsetS);
      this.set({ status: "playing", durationMs });
    }
    this.warmNeighbours();
  }

  /** Wraps a position into the loop, or clamps it to the buffer. */
  private normalize(s: number): number {
    const t = Math.max(0, s);
    if (this.loopS) return t % this.loopS;
    if (this.buffer) return Math.min(t, this.buffer.duration);
    return t;
  }

  /** True when the current item is a loop with a tempo or key change: it plays through the stretch. */
  private needsStretch(): boolean {
    return this.state.current?.kind === "loop" && (this.state.tempoRatio !== 1 || this.state.transpose !== 0);
  }

  /** How far ahead a stretch change is scheduled so it is heard exactly when the engine says. */
  private lead(): number {
    return Math.max(this.stretchLatency, STOP_AFTER_S) + LEAD_S;
  }

  private startVoice(offsetS: number) {
    const ctx = this.ctx;
    const master = this.master;
    const buffer = this.buffer;
    if (!ctx || !master || !buffer) return;
    // Replacing a sounding voice (seek, including to 0 or a wrap to the loop start) cuts the waveform
    // mid-cycle, so the new voice ramps in. A fresh start at 0 keeps its first transient.
    const replacing = this.voice !== null;
    this.stopVoice();
    const offset = this.normalize(offsetS);
    if (this.needsStretch()) this.startStretch(offset);
    else this.startPlain(offset, replacing);
  }

  private startPlain(offset: number, fadeIn: boolean) {
    const ctx = this.ctx!;
    const buffer = this.buffer!;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (this.loopS) {
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = this.loopS;
    }
    const gain = ctx.createGain();
    if (offset > 0 || fadeIn) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.setTargetAtTime(1, now, FADE_S);
    }
    src.connect(gain);
    gain.connect(this.master!);
    const voice: PlainVoice = { kind: "plain", src, gain };
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      if (this.voice !== voice) return;
      // Natural end of a one-shot or demo: back to the start, paused.
      this.voice = null;
      this.timeline = [];
      this.offsetS = 0;
      this.set({ status: "paused" });
    };
    src.start(now, offset);
    this.voice = voice;
    this.timeline = [{ at: now, pos: offset, rate: 1 }];
  }

  /** Starts the loop on the stretch once it is loaded; until then the position holds at `offset`. */
  private startStretch(offset: number) {
    const voice: StretchVoice = { kind: "stretch", started: false };
    this.voice = voice;
    this.timeline = [{ at: this.ctx!.currentTime, pos: offset, rate: 0 }];
    void this.prepareStretch().then((ok) => {
      if (this.voice !== voice) return;
      if (!ok) {
        // No stretch: play at the original tempo and key, and say so in state.
        this.voice = null;
        this.resetTempoAndKey();
        this.startPlain(offset, false);
        return;
      }
      const T = this.ctx!.currentTime + this.lead();
      this.scheduleStretchStart(T, offset);
      voice.started = true;
      this.timeline = [{ at: T, pos: offset, rate: this.state.tempoRatio }];
    });
  }

  /**
   * Tells the stretch to play from `pos` at time `T` with the current tempo and key. Always a complete
   * change: the installed library drops every change at or after the current time when a new one
   * arrives and fills missing fields from what is left, so a partial one could inherit "inactive".
   */
  private sendStretch(T: number, pos: number) {
    const pad = this.stretchPadS;
    this.stretchNode!
      .schedule({
        active: true,
        output: T,
        input: pad + pos,
        rate: this.state.tempoRatio,
        semitones: this.state.transpose,
        loopStart: pad,
        loopEnd: pad + (this.loopS ?? 0),
      })
      .catch((err: unknown) => console.warn("[audio]", err));
  }

  /**
   * Sends the stretch its start at `T` from `pos`, and opens its gain at T. Until T the gain falls to
   * zero from wherever it is: a seek or switch that just stopped the stretch keeps its fade-out (the
   * old position plays on underneath it until T), and the new position ramps in from silence.
   */
  private scheduleStretchStart(T: number, pos: number) {
    const gain = this.stretchGain!;
    const now = this.ctx!.currentTime;
    this.sendStretch(T, pos);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, FADE_S);
    gain.gain.setValueAtTime(0, T);
    gain.gain.setTargetAtTime(1, T, FADE_S);
  }

  /**
   * Loads the stretch if needed and gives it the current loop. Resolves false (never rejects) when it
   * cannot; a failed load is not kept, so the next change tries again.
   */
  private async prepareStretch(): Promise<boolean> {
    const ctx = this.ctx;
    const master = this.master;
    const buffer = this.buffer;
    const item = this.state.current;
    if (!ctx || !master || !buffer || item?.kind !== "loop") return false;
    try {
      this.stretchLoad ??= (async () => {
        // A worklet that throws before it says it is ready leaves both of these waiting forever.
        const node = await this.deadline(this.loadStretch(ctx), "the time stretch did not load", (late) => late.disconnect());
        let latency: number;
        try {
          latency = await this.deadline(node.latency(), "the time stretch did not answer");
        } catch (err) {
          node.disconnect(); // not kept, so the retry makes a new one: let this one go
          throw err;
        }
        const gain = ctx.createGain();
        gain.gain.value = 0;
        node.connect(gain);
        gain.connect(master);
        this.stretchNode = node;
        this.stretchGain = gain;
        this.stretchLatency = latency;
      })();
      await this.stretchLoad;
      if (this.stretchBuffer !== buffer) {
        const job = this.stretchChain.then(async () => {
          // Already in, or no longer wanted: a later item replaced this one while the job waited.
          if (this.stretchBuffer === buffer || this.buffer !== buffer) return;
          // Dropping the buffers under a fade still sounding would cut it: wait until it is silent.
          const fading = this.stretchQuietAt - ctx.currentTime;
          if (fading > 0) await this.sleep(fading);
          if (this.stretchBuffer === buffer || this.buffer !== buffer) return;
          const node = this.stretchNode!;
          const padFrames = Math.ceil(Math.max(PAD_S, 2 * this.stretchLatency) * buffer.sampleRate);
          const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
          const padded = paddedLoop(channels, loopFrames(item, buffer), padFrames);
          this.stretchBuffer = null;
          await node.dropBuffers();
          await node.addBuffers(padded, padded.map((p) => p.buffer));
          this.stretchBuffer = buffer;
          this.stretchPadS = padFrames / buffer.sampleRate;
        });
        this.stretchChain = job.catch(() => undefined);
        await job;
      }
      return this.stretchBuffer === buffer;
    } catch (err) {
      if (!this.stretchNode) this.stretchLoad = null;
      console.warn("[audio] time stretch unavailable; playing at the original tempo and key", err);
      return false;
    }
  }

  /**
   * Rejects with `what` if `p` has not settled within the stretch timeout. A value that lands after
   * that goes to `late`, so a node made too late can be let go.
   */
  private deadline<T>(p: Promise<T>, what: string, late?: (value: T) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(new Error(`${what} within ${this.stretchTimeoutMs} ms`));
      }, this.stretchTimeoutMs);
      p.then(
        (value) => {
          clearTimeout(timer);
          if (expired) late?.(value);
          else resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private resetTempoAndKey() {
    if (this.state.tempoRatio !== 1 || this.state.transpose !== 0) this.set({ tempoRatio: 1, transpose: 0 });
  }

  /** Called after a tempo or key change: moves a plain loop to the stretch, or updates the running stretch. */
  private applyTempoAndKey() {
    const v = this.voice;
    const ctx = this.ctx;
    if (!v || !ctx || this.state.current?.kind !== "loop") return;
    if (v.kind === "plain") {
      if (this.needsStretch()) void this.handoff(v);
      return;
    }
    if (!v.started) return; // its start reads the current tempo and key
    // A change still waiting to be heard (the start, or the last change) is replaced at its own time,
    // because sending a later one would drop it. Otherwise the change is heard one lead from now.
    const now = ctx.currentTime;
    const last = this.timeline.at(-1)!;
    const T = last.at > now ? last.at : now + this.lead();
    const pos = last.at > now ? last.pos : this.positionAt(T);
    const rate = this.state.tempoRatio;
    this.sendStretch(T, pos);
    this.timeline = [...this.timeline.filter((seg) => seg.at < T), { at: T, pos, rate }];
  }

  /**
   * Hands a playing plain loop to the stretch without restarting it: the stretch starts at T exactly
   * where the plain voice is at T, and the two crossfade there.
   */
  private async handoff(v: PlainVoice) {
    if (this.handoffFor === v) return;
    this.handoffFor = v;
    const ok = await this.prepareStretch();
    if (this.handoffFor === v) this.handoffFor = null;
    if (this.voice !== v) return; // paused, seeked or replaced meanwhile
    if (!ok) {
      this.resetTempoAndKey();
      return;
    }
    if (!this.needsStretch()) return; // back to the original tempo and key meanwhile
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const T = now + this.lead();
    const pos = this.positionAt(T);
    this.scheduleStretchStart(T, pos);
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, T, FADE_S);
    v.src.onended = () => {
      v.src.disconnect();
      v.gain.disconnect();
    };
    v.src.stop(T + STOP_AFTER_S);
    this.voice = { kind: "stretch", started: true };
    this.timeline = [...this.timeline, { at: T, pos, rate: this.state.tempoRatio }];
  }

  /** Fades the voice out over a few milliseconds and stops it. */
  private stopVoice() {
    const v = this.voice;
    const ctx = this.ctx;
    this.voice = null;
    this.timeline = [];
    if (!v || !ctx) return;
    const now = ctx.currentTime;
    if (v.kind === "plain") {
      v.src.onended = () => {
        v.src.disconnect();
        v.gain.disconnect();
      };
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, FADE_S);
      v.src.stop(now + STOP_AFTER_S);
    } else if (v.started && this.stretchNode && this.stretchGain) {
      this.stretchGain.gain.cancelScheduledValues(now);
      this.stretchGain.gain.setTargetAtTime(0, now, FADE_S);
      this.stretchNode.schedule({ active: false, output: now + STOP_AFTER_S }).catch((err: unknown) => console.warn("[audio]", err));
      this.stretchQuietAt = now + STOP_AFTER_S;
    }
  }

  /** The voice's position at audio-clock time t: held before its first segment, wrapped or clamped. */
  private positionAt(t: number): number {
    const first = this.timeline[0];
    if (!first) return this.offsetS;
    let seg = first;
    for (const s of this.timeline) if (s.at <= t) seg = s;
    if (t <= seg.at) return this.normalize(seg.pos);
    return this.normalize(seg.pos + (t - seg.at) * seg.rate);
  }

  private positionS(): number {
    if (this.voice && this.ctx) return this.positionAt(this.ctx.currentTime);
    return this.offsetS;
  }

  pause(): void {
    const status = this.state.status;
    if (status !== "playing" && status !== "loading") return;
    this.wantPlay = false;
    this.offsetS = this.positionS();
    this.stopVoice();
    this.set({ status: "paused" });
  }

  seek(positionMs: number): void {
    if (!Number.isFinite(positionMs)) return;
    const s = this.normalize(positionMs / 1000);
    if (this.voice) this.startVoice(s);
    else this.offsetS = s;
  }

  setTempo(bpm: number): void {
    const c = this.state.current;
    const base = c && (c.kind === "loop" || c.kind === "midi") ? c.bpm : undefined;
    if (!base || !Number.isFinite(bpm) || bpm <= 0) return;
    // Within the contract's BPM range: far outside it the stretch reads past its loop and goes silent.
    const clamped = Math.max(limits.bpm.min, Math.min(limits.bpm.max, bpm));
    this.set({ tempoRatio: clamped / base });
    this.applyTempoAndKey();
  }

  setTranspose(semitones: number): void {
    if (!Number.isFinite(semitones)) return;
    this.set({ transpose: Math.max(-12, Math.min(12, Math.round(semitones))) });
    this.applyTempoAndKey();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const v = Math.max(0, Math.min(1, volume));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, VOLUME_S);
    this.set({ volume: v });
  }

  // Kits (221), MIDI (223) and the preset sampler (224) give these sound.
  setSound(_sound: SoundId): void {}
  triggerPad(_index: number, _velocity?: number): void {}
  noteOn(_pitch: number, _velocity?: number): void {}
  noteOff(_pitch: number): void {}

  setQueue(items: Playable[], startIndex = 0): void {
    const queueIndex = items.length ? Math.max(0, Math.min(startIndex, items.length - 1)) : -1;
    this.set({ queue: items, queueIndex });
    const start = items[queueIndex];
    if (!start) return;
    // Nothing competes with an item still loading: wait for it. Then the start item, then its
    // neighbours, unless the queue changed or something outside it is now the current item.
    const after = this.loadingUrl ? this.loading : Promise.resolve();
    void after
      .then(() => (this.state.queue === items ? this.warm(start) : undefined))
      .then(() => {
        const { queue, queueIndex: i, current } = this.state;
        if (queue !== items) return;
        if (current && current.id !== items[i]?.id) return;
        for (const n of [items[i + 1], items[i - 1]]) if (n) void this.warm(n);
      });
  }

  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  private step(by: number) {
    const i = this.state.queueIndex + by;
    const item = this.state.queue[i];
    if (!item) return;
    this.set({ queueIndex: i });
    void this.play(item);
  }

  getState(): EngineState {
    return this.state;
  }

  getPositionMs(): number {
    return this.positionS() * 1000;
  }

  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

const ENGINE_KEY = Symbol.for("stash.audio.engine");

/**
 * One instance for the browser session. Kept on globalThis so client navigation, code splitting and
 * module re-evaluation (hot reload) all reach the same engine and the same audio context.
 */
export function getEngine(): Engine {
  const g = globalThis as { [ENGINE_KEY]?: Engine };
  g[ENGINE_KEY] ??= new WebAudioEngine();
  return g[ENGINE_KEY];
}
