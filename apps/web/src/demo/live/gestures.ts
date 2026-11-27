/**
 * The pocket model's gestures, as plain arithmetic (tested in Node): a swipe across the transport
 * changes the sound, and a press held on a row plays it until the finger lifts.
 */

/** How far a finger travels before a swipe counts, and how far it may drift before a hold is a scroll. */
export const SWIPE_PX = 48;
export const HOLD_MS = 320;
export const HOLD_SLOP_PX = 10;

/** A finished swipe: left is the next sound (it slides in from the right), right the one before. */
export function swipeOf(dx: number, dy: number, ms: number): "next" | "previous" | null {
  if (ms > 900) return null; // A slow drag is not a flick.
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dy) > Math.abs(dx) * 0.6) return null;
  return dx < 0 ? "next" : "previous";
}

/** Whether a finger that has moved (dx, dy) since it landed has left the spot a hold allows. */
export function drifted(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > HOLD_SLOP_PX;
}

/** How far the transport's screen follows the finger: fully at first, then with resistance. */
export function rubberBand(dx: number, limit = 72): number {
  const s = Math.sign(dx);
  const a = Math.abs(dx);
  return s * (a <= limit ? a : limit + Math.sqrt(a - limit) * 4);
}
