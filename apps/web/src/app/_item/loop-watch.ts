/**
 * Loop off, until the engine has a loop switch (docs/requests/135-engine-loop-switch.md): the frame
 * loop that draws the playhead reads the position anyway, and a jump back of more than half the
 * loop is the wrap to the start. The page then pauses at the start. A seek is a smaller step, or
 * comes after reset().
 */
export function createWrapWatch() {
  let last: number | null = null;
  const seen = (positionMs: number, durationMs: number): boolean => {
    const prev = last;
    last = positionMs;
    if (prev === null || !(durationMs > 0)) return false;
    return positionMs < prev - durationMs / 2;
  };
  return Object.assign(seen, {
    reset() {
      last = null;
    },
  });
}
