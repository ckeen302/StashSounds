import type { Playable, SoundId } from "@stash/contracts";

export type { Playable, SoundId };

/** Build spec: Audio engine interface. The Interface lane talks to sound through this and nothing else. */
export interface EngineState {
  status: "idle" | "loading" | "playing" | "paused" | "error";
  current: Playable | null;
  durationMs: number;
  /** 1 = original speed */
  tempoRatio: number;
  /** semitones */
  transpose: number;
  /** 0 to 1 */
  volume: number;
  /** Loops repeat while true (the default); while false a loop plays to its end once, then pauses at 0. */
  loop: boolean;
  queue: Playable[];
  queueIndex: number;
}

export interface Engine {
  /** Call on the first tap or key press. */
  unlock(): Promise<void>;
  /** Fetch and decode before play is pressed. */
  preload(item: Playable): void;
  /** No argument resumes. */
  play(item?: Playable): Promise<void>;
  pause(): void;
  seek(positionMs: number): void;
  /** Loops and MIDI. */
  setTempo(bpm: number): void;
  /** Loops, MIDI, one-shots. */
  setTranspose(semitones: number): void;
  setVolume(volume: number): void;
  /** Loops: on repeats, off plays the current pass to its end and pauses at 0. */
  setLoop(on: boolean): void;
  /** MIDI. */
  setSound(sound: SoundId): void;
  /** Kits. */
  triggerPad(index: number, velocity?: number): void;
  /** One-shots and Vital presets. */
  noteOn(pitch: number, velocity?: number): void;
  noteOff(pitch: number): void;
  setQueue(items: Playable[], startIndex?: number): void;
  next(): void;
  previous(): void;
  getState(): EngineState;
  /** Read every frame by the waveform. Position is not state. */
  getPositionMs(): number;
  subscribe(listener: (state: EngineState) => void): () => void;
}
