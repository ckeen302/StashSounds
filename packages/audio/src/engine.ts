import type { Engine, EngineState, Playable, SoundId } from "./types.ts";

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

/**
 * Phase 0 placeholder: tracks state exactly as the real engine will, but makes no sound.
 * Ticket 121 replaces the internals (audio context, loading, scheduling) behind the same interface,
 * so the Interface lane can build the player bar against this today.
 */
export class StateOnlyEngine implements Engine {
  private state: EngineState = { ...INITIAL_STATE };
  private listeners = new Set<(s: EngineState) => void>();
  private startedAt = 0;
  private offsetMs = 0;

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  async unlock(): Promise<void> {}
  preload(_item: Playable): void {}

  async play(item?: Playable): Promise<void> {
    if (item && item.id !== this.state.current?.id) {
      this.offsetMs = 0;
      this.set({ current: item, status: "playing" });
    } else if (this.state.current) {
      this.set({ status: "playing" });
    }
    this.startedAt = Date.now();
  }
  pause(): void {
    if (this.state.status !== "playing") return;
    this.offsetMs = this.getPositionMs();
    this.set({ status: "paused" });
  }
  seek(positionMs: number): void {
    this.offsetMs = Math.max(0, positionMs);
    this.startedAt = Date.now();
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
    this.set({ volume: Math.max(0, Math.min(1, volume)) });
  }
  setSound(_sound: SoundId): void {}
  triggerPad(_index: number, _velocity?: number): void {}
  noteOn(_pitch: number, _velocity?: number): void {}
  noteOff(_pitch: number): void {}
  setQueue(items: Playable[], startIndex = 0): void {
    this.set({ queue: items, queueIndex: items.length ? Math.min(startIndex, items.length - 1) : -1 });
  }
  next(): void {
    const i = this.state.queueIndex + 1;
    const item = this.state.queue[i];
    if (item) {
      this.set({ queueIndex: i });
      void this.play(item);
    }
  }
  previous(): void {
    const i = this.state.queueIndex - 1;
    const item = this.state.queue[i];
    if (item) {
      this.set({ queueIndex: i });
      void this.play(item);
    }
  }
  getState(): EngineState {
    return this.state;
  }
  getPositionMs(): number {
    return this.state.status === "playing" ? this.offsetMs + (Date.now() - this.startedAt) : this.offsetMs;
  }
  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let engine: Engine | null = null;

/** One instance for the browser session. */
export function getEngine(): Engine {
  engine ??= new StateOnlyEngine();
  return engine;
}
