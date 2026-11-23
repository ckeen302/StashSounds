import { BufferLoader } from "./loader.ts";
import type { Engine, EngineState, Playable, SoundId } from "./types.ts";
import { createBrowserContext } from "./web-audio.ts";
import type { AudioBufferLike, AudioContextLike, BufferSourceLike, FetchLike, GainNodeLike } from "./web-audio.ts";

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

export interface EngineDeps {
  /** Called once, on the first gesture. Defaults to the browser's AudioContext. */
  createContext?: () => AudioContextLike;
  fetch?: FetchLike;
}

interface Voice {
  src: BufferSourceLike;
  gain: GainNodeLike;
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
  private readonly loader: BufferLoader;

  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private voice: Voice | null = null;
  /** Buffer of the current item, once decoded. */
  private buffer: AudioBufferLike | null = null;
  /** Loop length in seconds for loops, else null. */
  private loopS: number | null = null;
  /** Position in seconds when no voice is playing; the voice's start offset while one is. */
  private offsetS = 0;
  /** ctx.currentTime when the voice started. */
  private startedAt = 0;
  /** Bumped by every load, so a slow earlier load never starts after a later play. */
  private generation = 0;
  /** Whether a load in flight should start playing when it lands (pause during loading clears it). */
  private wantPlay = false;

  constructor(deps: EngineDeps = {}) {
    this.createContext = deps.createContext ?? createBrowserContext;
    this.loader = new BufferLoader(deps.fetch ?? ((url) => globalThis.fetch(url)));
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
    if (!this.ctx) {
      try {
        const ctx = this.createContext();
        const master = ctx.createGain();
        master.gain.value = this.state.volume;
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
      } catch (err) {
        this.fail(err);
        return Promise.resolve(false);
      }
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
    const url = sourceUrl(item);
    if (!url) return;
    if (this.ctx) this.loader.load(url, this.ctx).catch(() => undefined);
    else this.loader.prefetch(url);
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
    if (!ctx) return;

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
    try {
      [ok, buffer] = await Promise.all([running, this.loader.load(url, ctx)]);
    } catch (err) {
      if (generation === this.generation) this.fail(err);
      return;
    }
    if (generation !== this.generation || !ok) return;

    this.buffer = buffer;
    this.loopS = target.kind === "loop" ? Math.min(target.loopSamples / target.sampleRate, buffer.duration) : null;
    const durationMs = (this.loopS ?? buffer.duration) * 1000;
    if (!this.wantPlay) {
      this.set({ status: "paused", durationMs });
      return;
    }
    this.startVoice(this.offsetS);
    this.set({ status: "playing", durationMs });
  }

  /** Wraps a position into the loop, or clamps it to the buffer. */
  private normalize(s: number): number {
    const t = Math.max(0, s);
    if (this.loopS) return t % this.loopS;
    if (this.buffer) return Math.min(t, this.buffer.duration);
    return t;
  }

  private startVoice(offsetS: number) {
    const ctx = this.ctx;
    const master = this.master;
    const buffer = this.buffer;
    if (!ctx || !master || !buffer) return;
    this.stopVoice();
    const offset = this.normalize(offsetS);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (this.loopS) {
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = this.loopS;
    }
    const gain = ctx.createGain();
    if (offset > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.setTargetAtTime(1, now, FADE_S);
    }
    src.connect(gain);
    gain.connect(master);
    const voice: Voice = { src, gain };
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      if (this.voice !== voice) return;
      // Natural end of a one-shot or demo: back to the start, paused.
      this.voice = null;
      this.offsetS = 0;
      this.set({ status: "paused" });
    };
    src.start(now, offset);
    this.voice = voice;
    this.offsetS = offset;
    this.startedAt = now;
  }

  /** Fades the voice out over a few milliseconds and stops it. */
  private stopVoice() {
    const v = this.voice;
    const ctx = this.ctx;
    if (!v || !ctx) return;
    this.voice = null;
    const now = ctx.currentTime;
    v.src.onended = () => {
      v.src.disconnect();
      v.gain.disconnect();
    };
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, FADE_S);
    v.src.stop(now + STOP_AFTER_S);
  }

  private positionS(): number {
    if (this.voice && this.ctx) return this.normalize(this.offsetS + (this.ctx.currentTime - this.startedAt));
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
    if (base && bpm > 0) this.set({ tempoRatio: bpm / base });
  }

  setTranspose(semitones: number): void {
    this.set({ transpose: Math.max(-12, Math.min(12, Math.round(semitones))) });
  }

  setVolume(volume: number): void {
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
    this.set({ queue: items, queueIndex: items.length ? Math.max(0, Math.min(startIndex, items.length - 1)) : -1 });
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
