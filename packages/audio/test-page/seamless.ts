// Seamless-loop harness (ticket 122), loaded into the test page by e2e/perf/audio-seamless-loop.spec.ts.
// Renders loops offline through the engine's own code in an OfflineAudioContext, and builds the
// references they must match. Returns numbers, not audio.
import SignalsmithStretch from "signalsmith-stretch";
import { WebAudioEngine } from "../src/engine.ts";
import { loopFrames } from "../src/loop-layout.ts";
import type { Playable } from "../src/types.ts";
import type { AudioBufferLike, StretchChange, StretchNodeLike } from "../src/web-audio.ts";
import { createBrowserStretch } from "../src/web-audio.ts";
import { joinFaults, joinReport, maxWindowedDifference } from "./join-metrics.ts";
import type { JoinReport } from "./join-metrics.ts";

type Loop = Extract<Playable, { kind: "loop" }>;
/** The engine's master gain at its default volume. */
const VOLUME = 0.8;

export interface Join {
  report: JoinReport;
  faults: { gap: boolean; click: boolean };
}
export interface PlainResult {
  status: string;
  loopFrames: number;
  /** Largest |rendered - expected| over both passes and both channels. */
  maxDiff: number;
  join: Join;
}
export interface StretchResult {
  status: string;
  /** Max windowed rms(difference)/rms(reference) after the stretch settles. */
  diff: { max: number; atS: number };
  joins: Join[];
  schedules: StretchChange[];
}

function bytesOf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function decode(bytes: Uint8Array, rate: number): Promise<AudioBuffer> {
  return new OfflineAudioContext(2, 1, rate).decodeAudioData(bytes.slice().buffer);
}

/** An OfflineAudioContext the engine can use: it has not started rendering, so resume() is a no-op for the engine. */
function offline(frames: number, rate: number) {
  const ctx = new OfflineAudioContext(2, frames, rate);
  const realResume = ctx.resume.bind(ctx);
  ctx.resume = async () => undefined;
  return { ctx, realResume };
}

/** Replies to schedules the worklet has not acknowledged yet. */
const pending = new Set<Promise<unknown>>();

/**
 * Waits until the worklet has handled every schedule sent so far. Rendering offline runs ahead as soon
 * as it resumes, so a change must have reached the processor before the render continues.
 */
async function delivered() {
  while (pending.size) await Promise.all([...pending]);
}

function engineFor(ctx: OfflineAudioContext, bytes: Uint8Array, schedules: StretchChange[]) {
  return new WebAudioEngine({
    createContext: () => ctx,
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer }),
    // The engine's own loader, with schedule() observed.
    loadStretch: async (c) => {
      const node: StretchNodeLike = await createBrowserStretch(c);
      const schedule = node.schedule.bind(node);
      node.schedule = (change) => {
        schedules.push({ ...change });
        const p = schedule(change);
        pending.add(p);
        void p.finally(() => pending.delete(p));
        return p;
      };
      return node;
    },
  });
}

async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!cond()) throw new Error(`timed out waiting for ${what}`);
}

function join(x: Float32Array, at: number, rate: number, start: number, end?: number): Join {
  const report = joinReport(x, Math.round(at), rate, { start: Math.round(start), end });
  return { report, faults: joinFaults(report) };
}

/** The decoded loop tiled `copies` times, per channel, for a reference with no loop point. */
function tiled(buffer: AudioBufferLike, frames: number, copies: number): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => {
    const src = buffer.getChannelData(c).subarray(0, frames);
    const out = new Float32Array(frames * copies);
    for (let k = 0; k < copies; k++) out.set(src, k * frames);
    return out;
  });
}

/** Plain path: two passes rendered by the engine must be the decoded loop twice, sample for sample. */
export async function renderPlain(b64: string, item: Loop, rate: number): Promise<PlainResult> {
  const bytes = bytesOf(b64);
  const decoded = await decode(bytes, rate);
  const L = loopFrames(item, decoded);
  const { ctx } = offline(2 * L, rate);
  const schedules: StretchChange[] = [];
  const e = engineFor(ctx, bytes, schedules);
  await e.play(item);
  const status = e.getState().status;
  const out = await ctx.startRendering();
  let maxDiff = 0;
  for (let c = 0; c < out.numberOfChannels; c++) {
    const got = out.getChannelData(c);
    const want = decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1));
    for (let i = 0; i < got.length; i++) maxDiff = Math.max(maxDiff, Math.abs(got[i]! - VOLUME * want[i % L]!));
  }
  if (schedules.length) throw new Error("the plain path used the stretch");
  return { status, loopFrames: L, maxDiff, join: join(out.getChannelData(0), L, rate, 0) };
}

/**
 * The same stretch over the loop tiled end to end, with no loop point. The stretch's output depends on
 * when its node was made and when each change reached it (its analysis hops run on their own grid from
 * the node's creation), so the reference does both at the same render time the engine did: before
 * rendering, or at `startAt` (node, buffers and start) and `change.suspendAt`.
 */
async function reference(
  decoded: AudioBuffer,
  L: number,
  frames: number,
  rate: number,
  start: StretchChange,
  startAt?: number,
  change?: { suspendAt: number; output: number; semitones: number },
) {
  const ctx = new OfflineAudioContext(2, frames, rate);
  const gain = ctx.createGain();
  gain.gain.value = VOLUME;
  gain.connect(ctx.destination);
  let node: Awaited<ReturnType<typeof SignalsmithStretch>> | null = null;
  const make = async () => {
    node = await SignalsmithStretch(ctx);
    await node.addBuffers(tiled(decoded, L, Math.ceil(frames / L) + 3));
    await node.schedule(start);
    node.connect(gain);
  };
  if (startAt === undefined) await make();
  else
    void ctx.suspend(startAt).then(async () => {
      await make();
      await ctx.resume();
    });
  if (change) {
    // Input by the processor's own continuity: the physically right place, whatever the engine computed.
    void ctx.suspend(change.suspendAt).then(async () => {
      await node!.schedule({ output: change.output, semitones: change.semitones });
      await ctx.resume();
    });
  }
  return (await ctx.startRendering()).getChannelData(0);
}

/**
 * Stretch from the start: transpose set before play, tempo right after. The looped render must match a
 * reference render of the loop tiled end to end with no loop point, through both joins.
 */
export async function renderStretch(b64: string, item: Loop, rate: number, ratio: number, semitones: number): Promise<StretchResult> {
  const bytes = bytesOf(b64);
  const decoded = await decode(bytes, rate);
  const L = loopFrames(item, decoded);
  const Ls = L / rate;
  const frames = Math.ceil((0.5 + (2 * Ls) / ratio + 0.3) * rate);
  const { ctx } = offline(frames, rate);
  const schedules: StretchChange[] = [];
  const e = engineFor(ctx, bytes, schedules);
  e.setTranspose(semitones);
  await e.play(item);
  e.setTempo(item.bpm! * ratio);
  await until(() => schedules.some((s) => s.active), "the stretch start");
  await delivered();
  const status = e.getState().status;
  const start = schedules.find((s) => s.active)!;
  const T = start.output!;
  const out = (await ctx.startRendering()).getChannelData(0);
  const ref = await reference(decoded, L, frames, rate, { active: true, output: T, input: Ls, rate: ratio, semitones });
  const from = Math.round((T + 0.1) * rate);
  const d = maxWindowedDifference(out, ref, from, frames - Math.round(0.05 * rate), rate);
  const joins = [1, 2].map((k) => T + (k * Ls) / ratio).filter((t) => t < frames / rate - 0.1).map((t) => join(out, t * rate, rate, from));
  return { status, diff: { max: d.max, atS: d.at / rate }, joins, schedules };
}

/**
 * Live change without restarting: plain playback from 0, tempo changed at 1 s (the handoff to the
 * stretch) and key changed 1.5 s later. Must match a reference that starts the stretch where the plain
 * loop physically is at the handoff, and changes key by continuity; no gap or click at either change.
 */
export async function renderLiveChange(b64: string, item: Loop, rate: number, ratio: number, semitones: number): Promise<StretchResult> {
  const bytes = bytesOf(b64);
  const decoded = await decode(bytes, rate);
  const L = loopFrames(item, decoded);
  const Ls = L / rate;
  const frames = Math.ceil(5.5 * rate);
  const { ctx, realResume } = offline(frames, rate);
  const schedules: StretchChange[] = [];
  const e = engineFor(ctx, bytes, schedules);
  await e.play(item);
  let first = 0;
  let second = 0;
  void ctx.suspend(1).then(async () => {
    first = ctx.currentTime;
    e.setTempo(item.bpm! * ratio);
    await until(() => schedules.some((s) => s.active), "the handoff");
    await delivered();
    await realResume();
  });
  const start1 = 1 + 0.14 + 1.5;
  void ctx.suspend(start1).then(async () => {
    second = ctx.currentTime;
    const n = schedules.length;
    e.setTranspose(semitones);
    await until(() => schedules.length > n, "the key change");
    await delivered();
    await realResume();
  });
  const out = (await ctx.startRendering()).getChannelData(0);
  const status = e.getState().status;
  const start = schedules.find((s) => s.active)!;
  const T = start.output!;
  const change = schedules.at(-1)!;
  const ref = await reference(decoded, L, frames, rate, { active: true, output: T, input: Ls + (T % Ls), rate: ratio, semitones: 0 }, first, { suspendAt: second, output: change.output!, semitones });
  const from = Math.round((T + 0.05) * rate);
  const d = maxWindowedDifference(out, ref, from, frames - Math.round(0.05 * rate), rate);
  const joins = [join(out, T * rate, rate, Math.round(0.2 * rate)), join(out, change.output! * rate, rate, from)];
  return { status, diff: { max: d.max, atS: d.at / rate }, joins, schedules };
}

export interface SeekResult {
  status: string;
  /** The seek, and the start of the new position. */
  joins: Join[];
  /**
   * rms of the 1 ms after the seek over the 1 ms before it. A 5 ms fade keeps it near 0.9; a cut
   * drops it to about 0. (A cut's single step can be smaller than the loop's own transients, so the
   * step check alone does not catch it.)
   */
  fadeOut: number;
  /** rms of the 1 ms after the new start over the loudest 1 ms from 20 to 80 ms later: small when it ramps in. */
  fadeIn: number;
  /** Where the engine says the new position started, in seconds of loop. */
  positionS: number;
  targetS: number;
}

function rms(x: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

/**
 * Seek while stretched: the loop plays through the stretch from the start, and at 1.5 s seeks to 37%
 * of the loop. The old position must fade out and the new one fade in: no cut or click at the seek or
 * at the new start. (The dip between them is the fade, by design, so it is not a gap.)
 */
export async function renderSeekStretched(b64: string, item: Loop, rate: number, ratio: number, semitones: number): Promise<SeekResult> {
  const bytes = bytesOf(b64);
  const decoded = await decode(bytes, rate);
  const L = loopFrames(item, decoded);
  const Ls = L / rate;
  const frames = Math.ceil(3 * rate);
  const { ctx, realResume } = offline(frames, rate);
  const schedules: StretchChange[] = [];
  const e = engineFor(ctx, bytes, schedules);
  e.setTranspose(semitones);
  await e.play(item);
  e.setTempo(item.bpm! * ratio);
  await until(() => schedules.some((s) => s.active), "the stretch start");
  await delivered();
  const seekAt = 1.5;
  const targetS = 0.37 * Ls;
  const lastStart = () => schedules.filter((s) => s.active).at(-1)!.output!;
  let positionS = NaN;
  let seekedAt = NaN; // the suspend lands on a render quantum, not exactly at seekAt
  void ctx.suspend(seekAt).then(async () => {
    seekedAt = ctx.currentTime;
    const n = schedules.length;
    e.seek(targetS * 1000);
    await until(() => schedules.slice(n).some((s) => s.active), "the restart after the seek");
    await delivered();
    await realResume();
  });
  void ctx.suspend(2.2).then(async () => {
    positionS = e.getPositionMs() / 1000 - (ctx.currentTime - lastStart()) * ratio;
    await realResume();
  });
  const out = (await ctx.startRendering()).getChannelData(0);
  const first = schedules.find((s) => s.active)!.output!;
  const from = Math.round((first + 0.1) * rate);
  const S = Math.round(seekedAt * rate);
  const T = Math.round(lastStart() * rate);
  const ms = Math.round(0.001 * rate);
  const joins = [join(out, S, rate, from), join(out, T, rate, from)];
  const fadeOut = rms(out, S, S + ms) / rms(out, S - ms, S);
  let settled = 0; // the loudest 1 ms of the new position once its ramp is over
  for (let i = T + Math.round(0.02 * rate); i < T + Math.round(0.08 * rate); i += ms) settled = Math.max(settled, rms(out, i, i + ms));
  const fadeIn = rms(out, T, T + ms) / settled;
  return { status: e.getState().status, joins, fadeOut, fadeIn, positionS, targetS };
}
