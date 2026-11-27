/**
 * The arithmetic behind the machine's meters, kept apart from Web Audio so it can be tested in Node.
 */

/** The meters' floor: anything quieter than this reads as silence. */
export const FLOOR_DB = -48;

/** Root mean square of one block of samples. */
export function rms(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    sum += s * s;
  }
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** An RMS value on the meter's 0..1 scale: FLOOR_DB is 0, full scale (0 dBFS) is 1. */
export function meterLevel(value: number): number {
  if (!(value > 0)) return 0;
  const db = 20 * Math.log10(value);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

/**
 * Meter ballistics, like a hardware peak meter: it jumps up at once and falls back slowly.
 * `dtMs` is the time since the last reading; the fall is `fallPerSecond` of full scale.
 */
export function ballistics(shown: number, target: number, dtMs: number, fallPerSecond = 1.6): number {
  if (target >= shown) return target;
  return Math.max(target, shown - (fallPerSecond * dtMs) / 1000);
}

/** How many of `segments` LEDs a level lights. */
export function litSegments(level: number, segments: number): number {
  return Math.max(0, Math.min(segments, Math.round(level * segments)));
}

/**
 * A kick finder: a beat is low-band energy rising well above its recent average, not too soon after
 * the last one. Cheap enough to run every frame on a phone.
 */
export class BeatFinder {
  private average = 0;
  private last = -Infinity;
  constructor(
    private readonly ratio = 1.35,
    private readonly minGapMs = 180,
    private readonly floor = 0.08,
  ) {}

  /** Feeds one reading of low-band energy (0..1) at `nowMs`; true when it is a beat. */
  feed(energy: number, nowMs: number): boolean {
    const beat = energy > this.floor && energy > this.average * this.ratio && nowMs - this.last >= this.minGapMs;
    // A slow average, so a run of loud bars still leaves room for the next kick to stand out.
    this.average = this.average * 0.92 + energy * 0.08;
    if (beat) this.last = nowMs;
    return beat;
  }

  reset() {
    this.average = 0;
    this.last = -Infinity;
  }
}

/** The mean of `bins[from..to)` on a 0..1 scale (analyser byte data is 0..255). */
export function band(bins: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(to, bins.length);
  for (let i = from; i < end; i++) sum += bins[i]!;
  return end > from ? sum / (end - from) / 255 : 0;
}

/**
 * Groups analyser bins into `count` bars on a log scale (bass gets as many bars as treble, the way
 * the ear hears it), each 0..1. Starts at bin 1 to skip DC.
 */
export function logBars(bins: ArrayLike<number>, count: number, out: Float32Array = new Float32Array(count)): Float32Array {
  const n = bins.length;
  const lo = 1;
  // The top quarter of the spectrum is mostly air on a 48 kHz context: leave it off the display.
  const hi = Math.max(lo + count, Math.floor(n * 0.75));
  for (let b = 0; b < count; b++) {
    const from = Math.floor(lo * Math.pow(hi / lo, b / count));
    const to = Math.max(from + 1, Math.floor(lo * Math.pow(hi / lo, (b + 1) / count)));
    out[b] = band(bins, from, to);
  }
  return out;
}
