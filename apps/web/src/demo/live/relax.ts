/**
 * What to try when a search finds nothing: the same search with one word left out (the word that
 * found nothing is usually the odd one), then a few searches that always find something.
 */
export const ALWAYS = ["dark 808", "bouncy 140", "drill", "rhodes"];

export function relaxations(query: string, max = 4, always: readonly string[] = ALWAYS): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  if (words.length > 1)
    for (let i = words.length - 1; i >= 0 && out.length < max; i--) {
      const q = words.filter((_, j) => j !== i).join(" ");
      if (!out.includes(q)) out.push(q);
    }
  for (const a of always) if (out.length < max && !out.includes(a) && a !== query.trim().toLowerCase()) out.push(a);
  return out;
}

/** For a bank searched by plain text: the query's own words that would find something on their own. */
export function wordsThatHit(query: string, hits: (word: string) => boolean, max = 4): string[] {
  const words = [...new Set(query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 1))];
  if (words.length < 2) return [];
  return words.filter(hits).slice(0, max);
}
