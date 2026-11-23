/**
 * Measures a loop join in rendered audio, for the seamless-loop test (ticket 122). Pure functions on
 * samples, so they run in the browser test and are unit tested in node.
 *
 * - Gap: the quietest 2.5 ms window near the join, against the quietest window anywhere else in the
 *   measured range. Undecoded MP3 padding or a loop played on the wrong length shows up as a dip
 *   that the rest of the loop never has.
 * - Click: the largest sample-to-sample step at the join, against the largest step anywhere else.
 *   A discontinuity bigger than anything the loop itself contains is a click.
 */
export interface JoinReport {
  stepAtJoin: number;
  maxStepElsewhere: number;
  minRmsNearJoin: number;
  minRmsElsewhere: number;
}

export interface JoinOptions {
  /** First and last sample to measure (default: the whole signal). */
  start?: number;
  end?: number;
  /** How far either side of the join counts as "near" for the gap check (default 50 ms). */
  nearMs?: number;
}

const WINDOW_MS = 2.5;
/** Steps this close to the join belong to it. */
const STEP_GUARD = 2;

export function joinReport(x: Float32Array, join: number, sampleRate: number, opts: JoinOptions = {}): JoinReport {
  const start = Math.max(1, opts.start ?? 0);
  const end = Math.min(x.length, opts.end ?? x.length);
  const near = Math.round(((opts.nearMs ?? 50) / 1000) * sampleRate);
  let stepAtJoin = 0;
  let maxStepElsewhere = 0;
  for (let i = start; i < end; i++) {
    const step = Math.abs(x[i]! - x[i - 1]!);
    if (Math.abs(i - join) <= STEP_GUARD) stepAtJoin = Math.max(stepAtJoin, step);
    else maxStepElsewhere = Math.max(maxStepElsewhere, step);
  }
  const w = Math.max(1, Math.round((WINDOW_MS / 1000) * sampleRate));
  let minRmsNearJoin = Infinity;
  let minRmsElsewhere = Infinity;
  for (let i = start; i + w <= end; i += Math.ceil(w / 2)) {
    let sum = 0;
    for (let j = i; j < i + w; j++) sum += x[j]! * x[j]!;
    const rms = Math.sqrt(sum / w);
    const centre = i + w / 2;
    if (Math.abs(centre - join) <= near) minRmsNearJoin = Math.min(minRmsNearJoin, rms);
    else if (Math.abs(centre - join) > near + w) minRmsElsewhere = Math.min(minRmsElsewhere, rms);
  }
  return { stepAtJoin, maxStepElsewhere, minRmsNearJoin, minRmsElsewhere };
}

/** The verdict: a gap if the join dips below half the loop's own quietest moment, a click if its step is 25% beyond the loop's largest. */
export function joinFaults(r: JoinReport): { gap: boolean; click: boolean } {
  return {
    gap: r.minRmsNearJoin < 0.5 * r.minRmsElsewhere,
    click: r.stepAtJoin > 1.25 * r.maxStepElsewhere + 1e-6,
  };
}

/**
 * The largest relative difference between two renders, over windows of `windowMs`: the rms of the
 * difference divided by the rms of `ref` in each window. 0 means identical.
 */
export function maxWindowedDifference(a: Float32Array, ref: Float32Array, start: number, end: number, sampleRate: number, windowMs = 10): { max: number; at: number } {
  const w = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  let max = 0;
  let at = start;
  for (let i = start; i + w <= Math.min(end, a.length, ref.length); i += w) {
    let d = 0;
    let s = 0;
    for (let j = i; j < i + w; j++) {
      d += (a[j]! - ref[j]!) ** 2;
      s += ref[j]! ** 2;
    }
    const rel = Math.sqrt(d / (s + 1e-12));
    if (rel > max) {
      max = rel;
      at = i;
    }
  }
  return { max, at };
}
