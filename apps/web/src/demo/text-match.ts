/**
 * Plain-text matching for search: names, artists, plugins, preset names and tags. Each query word
 * has to land on the start of a word in the text ("rap" does not find "trap"), with one typo forgiven
 * in longer words ("omnishpere" still finds Omnisphere) and two swapped letters in any word of three
 * or more ("kayne", "fuutre"). Nicknames read as the name ("ye", "hov", "weezy"). Accents,
 * apostrophes and case don't count.
 */

const STOP = new Set(["a", "an", "the", "and", "or", "with", "for", "in", "of", "to", "by", "type", "beat", "beats", "sound", "sounds", "some", "me", "give", "that", "this", "used", "on", "from"]);

/** "Beyoncé's" -> "beyonces"; "H*A*M" -> "h a m". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    // "A$AP", "$uicideboy$", "Ty Dolla $ign": the dollar sign is an s.
    .replace(/\$/g, "s")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

/** The words of a text, folded. */
export function terms(text: string): string[] {
  return fold(text).split(" ").filter(Boolean);
}

/**
 * What fans call an artist, to the name the libraries file them under. Whole words only, matched
 * on the folded query, so "ye" never eats the "ye" in "yeat".
 */
const NICKNAMES: [string, string][] = [
  ["ye", "kanye"],
  ["yeezy", "kanye"],
  ["yeezus", "kanye"],
  ["hov", "jay z"],
  ["hova", "jay z"],
  ["jigga", "jay z"],
  ["jayz", "jay z"],
  ["weezy", "lil wayne"],
  ["tunechi", "lil wayne"],
  ["drizzy", "drake"],
  ["champagne papi", "drake"],
  ["thugger", "young thug"],
  ["sosa", "chief keef"],
  ["pluto", "future"],
  ["la flame", "travis scott"],
  ["cactus jack", "travis scott"],
  ["kdot", "kendrick lamar"],
  ["k dot", "kendrick lamar"],
  ["kung fu kenny", "kendrick lamar"],
  ["jcole", "j cole"],
  ["breezy", "chris brown"],
  ["biggie", "notorious b i g"],
  ["biggie smalls", "notorious b i g"],
  ["pac", "2pac"],
  ["tupac", "2pac"],
  ["slim shady", "eminem"],
  ["marshall mathers", "eminem"],
  ["abel", "the weeknd"],
  ["yb", "youngboy"],
  ["nba yb", "youngboy"],
  ["riri", "rihanna"],
  ["bey", "beyonce"],
  ["queen b", "beyonce"],
  ["premo", "dj premier"],
  ["alc", "alchemist"],
  ["zay", "zaytoven"],
  ["xxx", "xxxtentacion"],
  ["tity boi", "2 chainz"],
  ["guwop", "gucci mane"],
  ["3 stacks", "andre 3000"],
  ["flacko", "asap rocky"],
];
const NICK = new Map(NICKNAMES);
const NICK_MAX = Math.max(...NICKNAMES.map(([k]) => k.split(" ").length));

/** The folded query with nicknames read as the names they stand for. */
export function expandNicknames(input: string): string {
  const ws = terms(input);
  const out: string[] = [];
  for (let i = 0; i < ws.length; ) {
    let n = Math.min(NICK_MAX, ws.length - i);
    for (; n >= 1; n--) {
      const name = NICK.get(ws.slice(i, i + n).join(" "));
      if (name) {
        out.push(name);
        break;
      }
    }
    if (n >= 1) i += n;
    else out.push(ws[i++]!);
  }
  return out.join(" ");
}

/** The words of a query that say something, folded, with nicknames read as names. */
export function queryWords(input: string): string[] {
  return [...new Set(terms(expandNicknames(input)).filter((w) => !STOP.has(w)))];
}

/** Edit distance where two swapped neighbours count as one edit ("kayne" is one from "kanye"), stopping once it passes `max`. */
export function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return false;
    before = prev;
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/** Same letters, two neighbours swapped once: "fuutre" is not one, "futrue" is. */
function swapped(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length && diff.length <= 2; i++) if (a[i] !== b[i]) diff.push(i);
  return diff.length === 2 && diff[1] === diff[0]! + 1 && a[diff[0]!] === b[diff[1]!] && a[diff[1]!] === b[diff[0]!];
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
    // Short words forgive only two swapped letters ("tarp" finds "trap", "ksi" doesn't find "kid").
    else if (!typos && best < 1 && w.length >= 3 && !/\d/.test(w) && swapped(t, w)) best = 1;
  }
  // "808s" against "808", "hats" against "hat", "boxes" against "box": a plural of a word in the text.
  if (best < 2 && w.length >= 3 && w.endsWith("s")) {
    const stems = w.endsWith("es") && w.length >= 5 ? [w.slice(0, -1), w.slice(0, -2)] : [w.slice(0, -1)];
    if (words.some((t) => stems.some((x) => t === x || (x.length >= 4 && t.startsWith(x))))) best = 2;
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

/**
 * Spelling fixes against the words the catalog actually uses: a query word the catalog never says
 * ("kayne", "drk") becomes the catalog word one edit away, two swapped letters first, then the most
 * common. Numbers and words of two letters stay as typed.
 */
export function respell(words: string[], vocab: Map<string, number>): { words: string[]; changed: boolean } {
  let changed = false;
  const out = words.map((w) => {
    if (w.length < 3 || /\d/.test(w) || vocab.has(w)) return w;
    let best: string | null = null;
    let bestRank = -1;
    for (const [v, n] of vocab) {
      if (Math.abs(v.length - w.length) > 1 || v[0] !== w[0] && !swapped(v.slice(0, 2), w.slice(0, 2))) continue;
      if (!within(v, w, 1)) continue;
      const rank = (swapped(v, w) ? 1e9 : 0) + n;
      if (rank > bestRank) {
        best = v;
        bestRank = rank;
      }
    }
    if (!best) return w;
    changed = true;
    return best;
  });
  return { words: out, changed };
}

/** Counts every word of the texts, for `respell`. */
export function vocabulary(texts: Iterable<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of texts) for (const w of terms(t)) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}
