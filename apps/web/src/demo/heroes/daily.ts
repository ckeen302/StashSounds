/** Today's pick from a list: the same all day for everyone, a different one tomorrow. `salt` keeps pages apart. */
export function daily<T>(list: readonly T[], salt = 0, day = Math.floor(Date.now() / 86_400_000)): T | undefined {
  if (!list.length) return undefined;
  const i = Math.abs((day * 2654435761 + salt * 40503) % 2147483647) % list.length;
  return list[i];
}

/** Up to `n` items, taking one from each group in turn, so a kit's pads cover every drum type first. */
export function roundRobin<T, K>(items: readonly T[], keyOf: (t: T) => K, order: readonly K[], n: number): T[] {
  const groups = new Map<K, T[]>();
  for (const t of items) {
    const k = keyOf(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  const keys = [...order.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !order.includes(k))];
  const out: T[] = [];
  for (let round = 0; out.length < n; round++) {
    let took = false;
    for (const k of keys) {
      const g = groups.get(k)!;
      if (round < g.length && out.length < n) {
        out.push(g[round]!);
        took = true;
      }
    }
    if (!took) break;
  }
  return out;
}

/** The keys that play pads, in pad order: four rows of four, the way a hand sits on a keyboard. */
export const PAD_KEYS = ["1", "2", "3", "4", "q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"] as const;

/** The computer keys that play a one-octave keyboard, C to B: the home row and the row above. */
export const NOTE_KEYS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j"] as const;

/** Whether a key event belongs to the page (not typing, no modifier). */
export function pageKey(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return false;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return false;
  return true;
}
