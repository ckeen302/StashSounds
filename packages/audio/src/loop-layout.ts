import type { Playable } from "./types.ts";
import type { AudioBufferLike } from "./web-audio.ts";

type Loop = Extract<Playable, { kind: "loop" }>;

/**
 * The loop's length in frames of the decoded buffer. The worker measures `loopSamples` at the file's
 * `sampleRate`; the browser decodes at the context's rate (often 48 kHz), and the MP3 decode may run
 * longer than the loop. Never more than was decoded, never less than one frame.
 */
export function loopFrames(item: Loop, buffer: AudioBufferLike): number {
  const frames = Math.round((item.loopSamples * buffer.sampleRate) / item.sampleRate);
  return Math.max(1, Math.min(frames, buffer.length));
}

/**
 * Lays each channel out as [last padFrames of the loop | the loop | first padFrames of the loop],
 * wrapping when the pad is longer than the loop. Signalsmith Stretch reads a window of input around its
 * play position and fills anything outside its buffers with silence, so without the pads every repeat
 * would start and end against silence. Returns fresh arrays, safe to transfer to the worklet.
 */
export function paddedLoop(channels: Float32Array[], loopFrameCount: number, padFrames: number): Float32Array[] {
  const L = loopFrameCount;
  return channels.map((x) => {
    const out = new Float32Array(padFrames + L + padFrames);
    out.set(x.subarray(0, L), padFrames);
    const wrap = (i: number) => x[(((i - padFrames) % L) + L) % L]!;
    for (let i = 0; i < padFrames; i++) {
      out[i] = wrap(i);
      out[padFrames + L + i] = wrap(padFrames + L + i);
    }
    return out;
  });
}
