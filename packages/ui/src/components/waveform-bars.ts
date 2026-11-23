/**
 * Waveform geometry, kept apart from the canvas so it can be tested. Design spec: The signature
 * views, Waveform. Bars come from the 800 stored peaks by taking the maximum within each bar's slice;
 * very quiet passages keep a minimum bar height of 2 px so the shape never vanishes.
 */

export const WAVEFORM_GEOMETRY = {
  mini: { bar: 2, gap: 1 },
  hero: { bar: 3, gap: 1 },
} as const;
export type WaveformVariant = keyof typeof WAVEFORM_GEOMETRY;

export const MIN_BAR_HEIGHT = 2;

/** How many bars fit in a width, and the left offset that centres them. */
export function barLayout(width: number, variant: WaveformVariant): { count: number; offset: number; step: number } {
  const { bar, gap } = WAVEFORM_GEOMETRY[variant];
  const step = bar + gap;
  const count = Math.max(0, Math.floor((width + gap) / step));
  const used = count > 0 ? count * step - gap : 0;
  return { count, offset: Math.floor((width - used) / 2), step };
}

/** Peak bytes (0 to 255) down to `count` bar values from 0 to 1: the maximum of each slice. */
export function barValues(peaks: Uint8Array, count: number): Float32Array {
  const out = new Float32Array(count);
  if (count === 0 || peaks.length === 0) return out;
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i * peaks.length) / count);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j++) max = Math.max(max, peaks[j]!);
    out[i] = max / 255;
  }
  return out;
}

/** Bar height in px for a value, never under the 2 px floor and never over the canvas. */
export function barHeight(value: number, height: number): number {
  return Math.min(height, Math.max(MIN_BAR_HEIGHT, Math.round(value * height)));
}

/** Pointer x to a 0 to 1 fraction of the width. */
export function fractionAt(x: number, width: number): number {
  if (width <= 0) return 0;
  return Math.min(1, Math.max(0, x / width));
}

/** m:ss for the time labels: 7300 ms is 0:07. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
