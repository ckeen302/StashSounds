import { ballistics, band, BeatFinder, meterLevel, rms } from "./meter-math";

/**
 * The machine's ears. Every sound in the demo (the loop engine, the MIDI synth, the drum pads,
 * one-shots, SFX) plays through its own AudioContext and ends at that context's speakers. This
 * module taps each context just before the speakers, so the screen, the meters and the pads can
 * react to whatever is actually sounding, without any player knowing about it.
 *
 * The tap: `AudioNode.prototype.connect` is wrapped once. A node connected to a context's
 * destination is also connected to that context's meter input (a gain feeding analysers that end in
 * a silent gain, so browsers keep processing them). Offline contexts (renders, downloads) and
 * contexts marked with `unmetered` (the UI's own click sounds) are left alone.
 *
 * Frames: while anything listens, the loop reads the analysers once per animation frame, but only
 * while something is sounding. When the machine goes quiet it drops to a few checks a second, and a
 * tap or key press wakes it at once, so an idle phone does no per-frame work.
 */

export type MeterFrame = {
  /** Something is sounding right now. */
  on: boolean;
  /** Overall level, 0..1, with peak-meter ballistics. */
  level: number;
  left: number;
  right: number;
  /** Low-band energy rose sharply: a kick or a hit. */
  beat: boolean;
  /** The loudest context's waveform (-1..1) and spectrum (0..255). Valid until the next frame. */
  wave: Float32Array;
  bins: Uint8Array;
  /** Milliseconds, from performance.now(). */
  t: number;
};

type Tap = {
  ctx: BaseAudioContext;
  input: GainNode;
  left: AnalyserNode;
  right: AnalyserNode;
  mono: AnalyserNode;
  wave: Float32Array<ArrayBuffer>;
  bins: Uint8Array<ArrayBuffer>;
  side: Float32Array<ArrayBuffer>;
};

const taps: Tap[] = [];
const tapOf = new WeakMap<BaseAudioContext, Tap>();
const skip = new WeakSet<BaseAudioContext>();
let installed = false;
type Connect = (this: AudioNode, dest: AudioNode | AudioParam, output?: number, input?: number) => unknown;
type Disconnect = (this: AudioNode, ...args: unknown[]) => unknown;
let originalConnect: Connect | null = null;

/** Keeps a context off the meters (the interface's own click sounds). */
export function unmetered(ctx: BaseAudioContext) {
  skip.add(ctx);
}

function tapFor(ctx: BaseAudioContext): Tap | null {
  const have = tapOf.get(ctx);
  if (have) return have;
  if (skip.has(ctx) || typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext) return null;
  const connect = originalConnect!;
  try {
    const input = ctx.createGain();
    input.channelCount = 2;
    input.channelCountMode = "explicit";
    input.channelInterpretation = "speakers";
    const split = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    const mono = ctx.createAnalyser();
    left.fftSize = right.fftSize = 256;
    mono.fftSize = 2048;
    mono.smoothingTimeConstant = 0.72;
    const silent = ctx.createGain();
    silent.gain.value = 0;
    connect.call(input, split);
    connect.call(split, left, 0);
    connect.call(split, right, 1);
    connect.call(input, mono);
    for (const a of [left, right, mono]) connect.call(a, silent);
    connect.call(silent, ctx.destination);
    const tap: Tap = {
      ctx,
      input,
      left,
      right,
      mono,
      wave: new Float32Array(mono.fftSize),
      bins: new Uint8Array(mono.frequencyBinCount),
      side: new Float32Array(left.fftSize),
    };
    tapOf.set(ctx, tap);
    taps.push(tap);
    wake();
    return tap;
  } catch {
    return null;
  }
}

/** Wraps AudioNode.connect once, so every context's output is metered. Safe to call again. */
export function installMeterTap() {
  if (installed || typeof AudioNode === "undefined" || typeof AudioDestinationNode === "undefined") return;
  installed = true;
  const proto = AudioNode.prototype;
  const connect = proto.connect as unknown as Connect;
  const disconnect = proto.disconnect as unknown as Disconnect;
  originalConnect = connect;
  const wrapped: Connect = function (this: AudioNode, dest, output, input) {
    const out = input === undefined ? (output === undefined ? connect.call(this, dest) : connect.call(this, dest, output)) : connect.call(this, dest, output, input);
    if (dest instanceof AudioDestinationNode) {
      const tap = tapFor(this.context);
      try {
        if (tap) connect.call(this, tap.input, output ?? 0, 0);
      } catch {
        // An output the meter cannot take: the sound still plays, it just is not metered.
      }
    }
    return out;
  };
  proto.connect = wrapped as unknown as AudioNode["connect"];
  const unwrapped: Disconnect = function (this: AudioNode, ...args: unknown[]) {
    const out = disconnect.apply(this, args);
    const dest = args[0];
    if (dest instanceof AudioDestinationNode) {
      const tap = tapOf.get(this.context);
      try {
        if (tap) disconnect.call(this, tap.input);
      } catch {
        // It was never connected to the meters.
      }
    }
    return out;
  };
  proto.disconnect = unwrapped as unknown as AudioNode["disconnect"];
}

// ---------------------------------------------------------------------------------------------
// The frame loop.

type Listener = (f: MeterFrame) => void;
const listeners = new Set<Listener>();
const beats = new BeatFinder();
const EMPTY_WAVE = new Float32Array(2048);
const EMPTY_BINS = new Uint8Array(1024);
let frame: MeterFrame = { on: false, level: 0, left: 0, right: 0, beat: false, wave: EMPTY_WAVE, bins: EMPTY_BINS, t: 0 };
let raf = 0;
let idleTimer = 0;
let quietSince = 0;
let lastT = 0;

function read(now: number): MeterFrame {
  let best: Tap | null = null;
  let bestLevel = 0;
  let l = 0;
  let r = 0;
  for (const tap of taps) {
    if ((tap.ctx as AudioContext).state !== "running") continue;
    tap.left.getFloatTimeDomainData(tap.side);
    const tl = meterLevel(rms(tap.side));
    tap.right.getFloatTimeDomainData(tap.side);
    const tr = meterLevel(rms(tap.side));
    l = Math.max(l, tl);
    r = Math.max(r, tr);
    const lv = Math.max(tl, tr);
    if (lv > bestLevel) {
      bestLevel = lv;
      best = tap;
    }
  }
  const dt = lastT ? now - lastT : 16;
  lastT = now;
  const on = bestLevel > 0.04;
  let beat = false;
  let wave = EMPTY_WAVE;
  let bins = EMPTY_BINS;
  if (best) {
    best.mono.getFloatTimeDomainData(best.wave);
    best.mono.getByteFrequencyData(best.bins);
    wave = best.wave;
    bins = best.bins;
    // About 20 to 150 Hz at 44.1 or 48 kHz with 1024 bins: where the kick and the 808 live.
    beat = on && beats.feed(band(bins, 1, 7), now);
  }
  const left = ballistics(frame.left, l, dt);
  const right = ballistics(frame.right, r, dt);
  return { on, level: Math.max(left, right), left, right, beat, wave, bins, t: now };
}

function tick(now: number) {
  raf = 0;
  frame = read(now);
  for (const fn of listeners) fn(frame);
  if (frame.on || frame.level > 0.01) quietSince = now;
  // Keep drawing for a moment after the sound stops, so the meters fall instead of freezing.
  if (now - quietSince < 1200) raf = requestAnimationFrame(tick);
  else idle();
}

function idle() {
  beats.reset();
  lastT = 0;
  if (!listeners.size || !taps.length) return;
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    idleTimer = 0;
    const f = read(performance.now());
    if (f.on) wake();
    else idle();
  }, 250);
}

/** Starts per-frame reading now (a tap or a key press is about to make a sound). */
export function wake() {
  if (raf || !listeners.size || !taps.length || typeof requestAnimationFrame === "undefined") return;
  clearTimeout(idleTimer);
  idleTimer = 0;
  quietSince = performance.now();
  raf = requestAnimationFrame(tick);
}

/** Calls `fn` with each frame while it is subscribed. Returns the unsubscribe. */
export function onMeterFrame(fn: Listener): () => void {
  listeners.add(fn);
  fn(frame);
  wake();
  if (!raf) idle();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
  };
}

/** The latest frame, outside React. */
export function meterFrame(): MeterFrame {
  return frame;
}

if (typeof window !== "undefined") {
  // Sound starts from a gesture: be reading by the time it does.
  for (const type of ["pointerdown", "keydown"] as const) window.addEventListener(type, () => setTimeout(wake, 30), { passive: true, capture: true });
}
