/**
 * The slice of the Web Audio API the engine uses, written structurally so the browser's AudioContext
 * satisfies it and unit tests can pass a fake. Shapes follow lib.dom.d.ts (TypeScript 6.0.3).
 */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly sampleRate: number;
  readonly length: number;
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  onended: ((ev: Event) => unknown) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export type ContextState = "closed" | "interrupted" | "running" | "suspended";

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: ContextState;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** The browser's context, created with the interactive latency hint. Throws where Web Audio is missing. */
export function createBrowserContext(): AudioContextLike {
  const Ctor = (globalThis as { AudioContext?: new (o?: AudioContextOptions) => AudioContext }).AudioContext;
  if (!Ctor) throw new Error("Web Audio is not available");
  return new Ctor({ latencyHint: "interactive" }) as unknown as AudioContextLike;
}
