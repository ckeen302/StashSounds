// The package ships no types, and an ambient declaration for an untyped package has no import form
// (in a module it would be an augmentation, which TypeScript refuses). The reference makes it
// reachable from the entry point, so a consumer that compiles only index.ts gets it too.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./signalsmith-stretch.d.ts" />
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
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
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

/** One change to a stretch node's playback (signalsmith-stretch 1.3.2, `schedule`). Times in seconds. */
export interface StretchChange {
  /** Audio context time the change is heard at. */
  output?: number;
  active?: boolean;
  /** Position in the node's input buffers. */
  input?: number;
  rate?: number;
  semitones?: number;
  loopStart?: number;
  loopEnd?: number;
}

/** The parts of the Signalsmith Stretch node the engine uses (an AudioWorkletNode with extra methods). */
export interface StretchNodeLike extends AudioNodeLike {
  addBuffers(channels: Float32Array[], transfer?: Transferable[]): Promise<number>;
  dropBuffers(): Promise<unknown>;
  schedule(change: StretchChange): Promise<unknown>;
  /** Seconds between scheduling a change and hearing it fully. */
  latency(): Promise<number>;
}

/** The loader always sends cookies-free requests that it can abort. */
export interface FetchInit {
  credentials: "omit";
  signal: AbortSignal;
}
export type FetchLike = (url: string, init?: FetchInit) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** The signalsmith-stretch version this engine is built and tested against (package.json pins it). */
export const STRETCH_VERSION = "1.3.2";

/**
 * Where the app serves the library's own SignalsmithStretch.mjs, unminified, for the worklet to load
 * (request 135-stretch-in-production-build). The version in the path keeps a cached copy from ever
 * serving another library version to this page. `@stash/audio/stretch-worklet-file` names the file to
 * copy there at build time; a unit test holds the two paths equal.
 */
export const STRETCH_WORKLET_PATH = `/worklets/signalsmith-stretch-${STRETCH_VERSION}.mjs`;

/**
 * Loads Signalsmith Stretch and makes its node. A dynamic import, so the library (WASM inlined, about
 * 110 KB) is fetched the first time a loop needs a tempo or key change, never with the page.
 *
 * Left alone, the library builds its worklet by stringifying its own functions. In the production
 * bundle those functions refer to names from the module around them (Turbopack's process polyfill,
 * minified to one letter), so the worklet threw "g is not defined" and never said it was ready. With
 * `moduleUrl` set, the worklet loads the unminified file instead, and only the main-thread half runs
 * from the bundle.
 */
export async function createBrowserStretch(ctx: AudioContextLike, moduleUrl: string = STRETCH_WORKLET_PATH): Promise<StretchNodeLike> {
  const { default: SignalsmithStretch } = await import("signalsmith-stretch");
  SignalsmithStretch.moduleUrl = moduleUrl;
  // The library's defaults (one input, one stereo output). Its processor reads `inputs.length` while
  // inactive, so a node with zero inputs throws in the worklet and goes silent.
  return SignalsmithStretch(ctx as unknown as BaseAudioContext);
}

/** The browser's context, created with the interactive latency hint. Throws where Web Audio is missing. */
export function createBrowserContext(): AudioContextLike {
  const Ctor = (globalThis as { AudioContext?: new (o?: AudioContextOptions) => AudioContext }).AudioContext;
  if (!Ctor) throw new Error("Web Audio is not available");
  // No cast: this line is the compile-time proof that the browser context fits AudioContextLike.
  return new Ctor({ latencyHint: "interactive" });
}
