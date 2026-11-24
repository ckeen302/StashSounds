/**
 * Plain-text matching for search: names, artists, plugins, preset names and tags. Each query word
 * has to land on the start of a word in the text ("rap" does not find "trap"), with one typo forgiven
 * in longer words ("omnishpere" still finds Omnisphere). Accents, apostrophes and case don't count.
 */

const STOP = new Set(["a", "an", "the", "and", "or", "with", "for", "in", "of", "to", "by", "type", "beat", "beats", "sound", "sounds", "some", "me", "give", "that", "this", "used", "on", "from"]);

/** "Beyoncé's" -> "beyonces"; "H*A*M" -> "h a m". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

/** The words of a text, folded. */
export function terms(text: string): string[] {
  return fold(text).split(" ").filter(Boolean);
}

/** The words of a query that say something, folded. */
export function queryWords(input: string): string[] {
  return [...new Set(terms(input).filter((w) => !STOP.has(w)))];
}

/** Edit distance, stopping early once it passes `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/** How well one query word lands in a list of words: 3 exact, 2 start of a word, 1 a typo away, 0 not at all. */
export function termHit(words: string[], w: string): number {
  let best = 0;
  // Short words have too many neighbours ("gods" vs "good"), so only longer ones forgive a typo.
  const typos = w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0;
  for (const t of words) {
    if (t === w) return 3;
    if (t.startsWith(w) && (w.length >= 2 || /\d/.test(w))) best = Math.max(best, 2);
    else if (typos && best < 1 && (within(t, w, typos) || (w.length >= 6 && t.length > w.length && within(t.slice(0, w.length), w, 1)))) best = 1;
  }
  // "hihat" against "hi hat", "pluggnb" against "plugg n b": the words run together.
  if (!best && w.length >= 5 && words.join("").includes(w)) best = 1;
  return best;
}

export type Field = { text: string; weight: number };
export type TextHit = { score: number; all: boolean; hits: number };

/**
 * Scores a thing with several fields (title, artist, tags...) against the query words. `all` says
 * every word landed somewhere; callers show those first and the rest only as close matches.
 */
export function textMatch(fields: Field[], words: string[]): TextHit | null {
  if (!words.length) return null;
  const split = fields.map((f) => ({ words: terms(f.text), weight: f.weight }));
  let score = 0;
  let hits = 0;
  for (const w of words) {
    let best = 0;
    for (const f of split) best = Math.max(best, termHit(f.words, w) * f.weight);
    if (best) {
      hits++;
      score += best;
    }
  }
  if (!hits) return null;
  // The whole query as a phrase at the start of the first field (the title) ranks highest.
  const phrase = words.join(" ");
  const first = split[0]?.words.join(" ") ?? "";
  if (first === phrase) score += 12;
  else if (first.startsWith(phrase)) score += 6;
  return { score, all: hits === words.length, hits };
}
