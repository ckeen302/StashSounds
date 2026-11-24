import type { MusicalKey } from "@stash/contracts";
import { compatibleKeys, formatKey } from "@stash/contracts/format";

/**
 * Search the way producers type: "dark piano 140 like metro", "c minor bells", "drill 140-145",
 * "pluggnb". The query is read into facets (tempo, key, genre, sound, mood, a producer's style and
 * plain words); each facet either narrows the results or ranks them, and every result says why it
 * matched. The same profile drives "more like this".
 */

export const GENRE_NAMES = ["Trap", "Drill", "Boom bap", "Plugg", "R&B", "Soul", "Lo-fi", "Phonk", "Rage", "Jersey club", "West Coast"] as const;
export type Genre = (typeof GENRE_NAMES)[number];

const GENRE_ALIASES: [Genre, string[]][] = [
  ["Trap", ["trap", "melodic trap", "dark trap", "atl"]],
  ["Drill", ["drill", "uk drill", "ny drill", "chicago drill", "brooklyn drill"]],
  ["Boom bap", ["boom bap", "boombap", "boom-bap", "90s", "golden era"]],
  ["Plugg", ["plugg", "pluggnb", "plug", "plugg n b"]],
  ["R&B", ["r&b", "rnb", "r n b", "neo soul", "neo-soul"]],
  ["Soul", ["soul", "soulful", "neo soul"]],
  ["Lo-fi", ["lo-fi", "lofi", "lo fi"]],
  ["Phonk", ["phonk", "memphis"]],
  ["Rage", ["rage"]],
  ["Jersey club", ["jersey club", "jersey", "club"]],
  ["West Coast", ["west coast", "westcoast", "g funk", "g-funk", "gfunk"]],
];

/** Sounds, by what producers call them. The first alias is the label. */
const SOUND_ALIASES: [string, string[]][] = [
  ["Piano", ["piano", "pianos"]],
  ["Keys", ["keys", "rhodes", "electric piano", "ep", "organ", "wurli", "wurlitzer"]],
  ["Bells", ["bell", "bells", "glock", "glockenspiel", "music box", "celesta", "chime", "chimes"]],
  ["Pad", ["pad", "pads", "atmosphere", "atmos"]],
  ["Strings", ["string", "strings", "violin", "violins", "cello", "orchestra", "orchestral"]],
  ["Guitar", ["guitar", "guitars", "acoustic"]],
  ["Pluck", ["pluck", "plucks", "arp", "arps", "arpeggio"]],
  ["Lead", ["lead", "leads", "whistle", "stab", "stabs"]],
  ["Synth", ["synth", "synths", "saw", "supersaw"]],
  ["808", ["808", "808s", "bass", "sub", "slide", "slides", "glide"]],
  ["Drums", ["drums", "drum", "hats", "hat", "hi hats", "hihats", "snare", "kick", "perc", "percussion", "rolls"]],
  ["Cowbell", ["cowbell", "cowbells"]],
  ["Choir", ["choir", "vocal", "vocals", "vox", "voice"]],
  ["Flute", ["flute", "flutes", "pan flute"]],
  ["Brass", ["brass", "horn", "horns", "trumpet"]],
  ["Chords", ["chords", "chord", "progression", "progressions"]],
  ["Melody", ["melody", "melodies", "topline"]],
];

const MOOD_ALIASES: [string, string[]][] = [
  ["Dark", ["dark", "evil", "eerie", "creepy", "sinister", "spooky", "haunted", "menacing"]],
  ["Sad", ["sad", "emotional", "emo", "pain", "heartbreak", "melancholy"]],
  ["Happy", ["happy", "uplifting", "bright", "feel good"]],
  ["Bouncy", ["bouncy", "bounce", "groovy", "swing", "swung"]],
  ["Hard", ["hard", "aggressive", "gritty", "distorted", "grimy"]],
  ["Chill", ["chill", "smooth", "mellow", "laid back", "calm", "relaxed"]],
  ["Dreamy", ["dreamy", "ambient", "spacey", "ethereal", "airy"]],
  ["Jazzy", ["jazzy", "jazz", "nines", "ninths"]],
  ["Dusty", ["dusty", "vinyl", "warm", "lofi"]],
];

/**
 * Producers people name in a search ("like metro", "pierre type"). Each points at the genres, sounds
 * and moods their records are known for; a song by that producer in the MIDI library ranks first.
 */
const STYLES: { name: string; aliases: string[]; genres: Genre[]; sounds: string[]; moods: string[] }[] = [
  { name: "Metro Boomin", aliases: ["metro boomin", "metro"], genres: ["Trap"], sounds: ["Piano", "Bells", "808", "Strings"], moods: ["Dark"] },
  { name: "Southside", aliases: ["southside", "808 mafia"], genres: ["Trap"], sounds: ["808", "Bells", "Drums"], moods: ["Dark", "Hard"] },
  { name: "Wheezy", aliases: ["wheezy"], genres: ["Trap"], sounds: ["Guitar", "Pluck", "Bells"], moods: ["Bouncy"] },
  { name: "Pi'erre Bourne", aliases: ["pierre bourne", "pi'erre bourne", "pierre", "pi'erre"], genres: ["Plugg", "Trap"], sounds: ["Bells", "Synth", "Lead"], moods: ["Bouncy", "Happy"] },
  { name: "Zaytoven", aliases: ["zaytoven", "zay"], genres: ["Trap"], sounds: ["Piano", "Keys", "Bells"], moods: ["Bouncy"] },
  { name: "TM88", aliases: ["tm88"], genres: ["Trap"], sounds: ["Bells", "808"], moods: ["Dark"] },
  { name: "Tay Keith", aliases: ["tay keith"], genres: ["Trap"], sounds: ["808", "Drums"], moods: ["Bouncy", "Hard"] },
  { name: "Lex Luger", aliases: ["lex luger", "luger"], genres: ["Trap"], sounds: ["Strings", "Brass", "808"], moods: ["Hard", "Dark"] },
  { name: "London on da Track", aliases: ["london on da track", "london"], genres: ["Trap"], sounds: ["Bells", "Melody"], moods: ["Happy"] },
  { name: "Nick Mira", aliases: ["nick mira", "internet money", "taz taylor"], genres: ["Trap"], sounds: ["Guitar", "Pluck", "Melody"], moods: ["Sad"] },
  { name: "CuBeatz", aliases: ["cubeatz"], genres: ["Trap"], sounds: ["Guitar", "Melody"], moods: ["Sad", "Dreamy"] },
  { name: "F1LTHY", aliases: ["f1lthy", "filthy", "working on dying"], genres: ["Rage"], sounds: ["Synth", "Lead"], moods: ["Hard"] },
  { name: "AXL Beats", aliases: ["axl beats", "axl", "ax"], genres: ["Drill"], sounds: ["Strings", "Choir", "808"], moods: ["Dark"] },
  { name: "808Melo", aliases: ["808melo", "808 melo"], genres: ["Drill"], sounds: ["808", "Strings", "Choir"], moods: ["Dark"] },
  { name: "J Dilla", aliases: ["j dilla", "dilla"], genres: ["Boom bap", "Soul"], sounds: ["Keys", "Drums"], moods: ["Dusty", "Jazzy", "Bouncy"] },
  { name: "The Alchemist", aliases: ["alchemist", "alc"], genres: ["Boom bap", "Soul"], sounds: ["Keys", "Strings"], moods: ["Dusty", "Dark"] },
  { name: "Madlib", aliases: ["madlib"], genres: ["Boom bap", "Soul"], sounds: ["Keys"], moods: ["Dusty", "Jazzy"] },
  { name: "DJ Premier", aliases: ["dj premier", "premier", "premo"], genres: ["Boom bap"], sounds: ["Piano", "Drums"], moods: ["Hard", "Dusty"] },
  { name: "9th Wonder", aliases: ["9th wonder"], genres: ["Boom bap", "Soul"], sounds: ["Keys", "Choir"], moods: ["Dusty"] },
  { name: "Nujabes", aliases: ["nujabes"], genres: ["Lo-fi"], sounds: ["Piano", "Keys"], moods: ["Jazzy", "Chill"] },
  { name: "Kaytranada", aliases: ["kaytranada", "kaytra"], genres: ["R&B"], sounds: ["Keys", "Synth"], moods: ["Bouncy"] },
  { name: "Brent Faiyaz", aliases: ["brent faiyaz", "brent", "sza", "frank ocean", "daniel caesar"], genres: ["R&B"], sounds: ["Pad", "Keys", "Guitar"], moods: ["Chill", "Dreamy"] },
  { name: "Dr. Dre", aliases: ["dr dre", "dre", "dj quik", "quik"], genres: ["West Coast"], sounds: ["Lead", "Synth", "Piano"], moods: ["Bouncy"] },
  { name: "Mustard", aliases: ["mustard", "dj mustard"], genres: ["West Coast"], sounds: ["Synth", "808"], moods: ["Bouncy"] },
  { name: "DJ Paul", aliases: ["dj paul", "three 6", "three six", "three 6 mafia"], genres: ["Phonk"], sounds: ["Cowbell", "808"], moods: ["Dark"] },
  { name: "Kordhell", aliases: ["kordhell"], genres: ["Phonk"], sounds: ["Cowbell", "808"], moods: ["Hard"] },
];

// Words that say nothing about the sound.
const STOP = new Set(["a", "an", "the", "and", "or", "with", "for", "in", "of", "to", "like", "type", "beat", "beats", "loop", "loops", "sample", "samples", "midi", "style", "vibe", "vibes", "some", "me", "give", "sound", "sounds", "kind", "that", "this", "bpm", "key"]);

const NOTE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export type Token = { kind: "bpm" | "key" | "genre" | "sound" | "mood" | "style" | "word"; label: string; raw: string };
export type Query = {
  tokens: Token[];
  bpm: { min: number; max: number; exact: number | null } | null;
  key: MusicalKey | null;
  genres: Genre[];
  sounds: string[];
  moods: string[];
  styles: (typeof STYLES)[number][];
  words: string[];
  empty: boolean;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Reads "dark piano 140 like metro" into facets. Longest phrases win, and each word is used once. */
export function parseQuery(input: string): Query {
  const tokens: Token[] = [];
  let rest = ` ${input.toLowerCase().replace(/[’']/g, "'").replace(/[,;!?]/g, " ")} `;
  // Each match the reader accepts is blanked out (same length, so later matches keep their place).
  const take = (re: RegExp, fn: (m: RegExpExecArray) => Token | null) => {
    const all = new RegExp(re.source, "g");
    for (const m of [...rest.matchAll(all)] as RegExpExecArray[]) {
      if (rest.slice(m.index, m.index + m[0].length) !== m[0]) continue; // taken by an earlier match
      const t = fn(m);
      if (!t) continue;
      rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length);
      tokens.push(t);
    }
  };

  let bpm: Query["bpm"] = null;
  take(/(?<![\w#])(\d{2,3})\s*(?:-|to|–)\s*(\d{2,3})(?:\s*bpm)?(?!\w)/, (m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a < 40 || b > 250) return null;
    bpm = { min: Math.min(a, b), max: Math.max(a, b), exact: null };
    return { kind: "bpm", label: `${bpm.min} to ${bpm.max} BPM`, raw: m[0].trim() };
  });
  take(/(?<![\w#])(\d{2,3})s(?!\w)/, (m) => {
    const a = Number(m[1]);
    if (a < 40 || a > 240 || a % 10) return null;
    bpm = { min: a, max: a + 9, exact: null };
    return { kind: "bpm", label: `${a} to ${a + 9} BPM`, raw: m[0].trim() };
  });
  take(/(?<![\w#])(\d{2,3})(?:\s*bpm)?(?!\w)/, (m) => {
    const a = Number(m[1]);
    if (a < 50 || a > 220) return null;
    bpm = { min: a - 3, max: a + 3, exact: a };
    return { kind: "bpm", label: `${a} BPM`, raw: m[0].trim() };
  });

  let key: MusicalKey | null = null;
  take(/(?<![\w])([a-g])\s*(#|sharp|b|flat|♯|♭)?\s*(minor|min|major|maj|m)(?!\w)/, (m) => {
    // "bm" reads as B minor; "bbm" as B flat minor.
    let root = NOTE[m[1]!]!;
    const acc = m[2];
    if (acc === "#" || acc === "sharp" || acc === "♯") root += 1;
    if (acc === "b" || acc === "flat" || acc === "♭") root -= 1;
    const mode = m[3]!.startsWith("maj") ? "major" : "minor";
    key = { root: (root + 12) % 12, mode } as MusicalKey;
    return { kind: "key", label: formatKey(key), raw: m[0].trim() };
  });

  const styles: Query["styles"] = [];
  const phrases: { kind: "style" | "genre" | "sound" | "mood"; alias: string; apply: () => string }[] = [];
  for (const s of STYLES) for (const a of s.aliases) phrases.push({ kind: "style", alias: a, apply: () => (styles.includes(s) || styles.push(s), `Like ${s.name}`) });
  const genres: Genre[] = [];
  for (const [g, as] of GENRE_ALIASES) for (const a of as) phrases.push({ kind: "genre", alias: a, apply: () => (genres.includes(g) || genres.push(g), g) });
  const sounds: string[] = [];
  for (const [n, as] of SOUND_ALIASES) for (const a of as) phrases.push({ kind: "sound", alias: a, apply: () => (sounds.includes(n) || sounds.push(n), n) });
  const moods: string[] = [];
  for (const [n, as] of MOOD_ALIASES) for (const a of as) phrases.push({ kind: "mood", alias: a, apply: () => (moods.includes(n) || moods.push(n), n) });
  // Longest first, so "uk drill" beats "drill" and "metro boomin" beats "metro"; styles before
  // sounds, so "808 melo" is a producer and not an 808.
  phrases.sort((a, b) => b.alias.length - a.alias.length || (a.kind === "style" ? -1 : b.kind === "style" ? 1 : 0));
  for (const p of phrases) {
    take(new RegExp(`(?<![\\w&'])${esc(p.alias)}(?![\\w&'])`), (m) => {
      const label = p.apply();
      return tokens.some((t) => t.kind === p.kind && t.label === label) ? null : { kind: p.kind, label, raw: m[0].trim() };
    });
  }

  const words = rest
    .split(/\s+/)
    .map((w) => w.replace(/^[^\w#&]+|[^\w#&]+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w));
  for (const w of words) tokens.push({ kind: "word", label: `“${w}”`, raw: w });

  const order = { style: 0, genre: 1, sound: 2, mood: 3, bpm: 4, key: 5, word: 6 };
  tokens.sort((a, b) => order[a.kind] - order[b.kind]);
  return { tokens, bpm, key, genres, sounds, moods, styles, words, empty: tokens.length === 0 };
}

/** Removes one token's text from the query, for the chip's remove button. */
export function withoutToken(input: string, t: Token): string {
  const re = new RegExp(`(?<![\\w&'])${esc(t.raw)}(?![\\w&'])`, "i");
  const out = input.replace(re, " ");
  // "like metro": take the "like" too.
  return (t.kind === "style" ? out.replace(/\blike\s+(?=\s|$)/i, " ") : out).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------------------------
// What a sound is, in the same words.

export type Profile = {
  id: string;
  kind: "loop" | "midi";
  title: string;
  bpm: number | null;
  key: MusicalKey | null;
  genres: Genre[];
  sounds: string[];
  moods: string[];
  /** Everything searchable as text: title, tags, description, owner, song and artist. */
  text: string;
  /** For song chords: the artist and producer, matched against a named style. */
  people: string[];
  publishedAt: string;
};

function hits(aliases: [string, string[]][], text: string): string[] {
  return aliases.filter(([, as]) => as.some((a) => new RegExp(`(?<![\\w&'])${esc(a)}(?![\\w&'])`).test(text))).map(([n]) => n);
}

export function profile(p: { id: string; kind: "loop" | "midi"; title: string; bpm: number | null; key: MusicalKey | null; words: string[]; people?: string[]; publishedAt: string }): Profile {
  const text = ` ${p.words.join(" ").toLowerCase()} `;
  return {
    id: p.id,
    kind: p.kind,
    title: p.title,
    bpm: p.bpm,
    key: p.key,
    genres: hits(GENRE_ALIASES, text) as Genre[],
    sounds: hits(SOUND_ALIASES, text),
    moods: hits(MOOD_ALIASES, text),
    text,
    people: (p.people ?? []).map((s) => s.toLowerCase()),
    publishedAt: p.publishedAt,
  };
}

const sameKey = (a: MusicalKey, b: MusicalKey) => a.root === b.root && a.mode === b.mode;

function tempoFit(bpm: number, q: NonNullable<Query["bpm"]>): "exact" | "half" | null {
  if (bpm >= q.min && bpm <= q.max) return "exact";
  if (q.exact !== null) {
    if (Math.abs(bpm * 2 - q.exact) <= 3 || Math.abs(bpm - q.exact * 2) <= 3) return "half";
  } else if ((bpm * 2 >= q.min && bpm * 2 <= q.max) || (bpm / 2 >= q.min && bpm / 2 <= q.max)) return "half";
  return null;
}

export type Match = { score: number; why: string[] };

/**
 * Scores one sound against the query, or null when it is out. Tempo, key, genre and sound narrow;
 * moods, a named style and plain words rank (a word that matches nothing narrows to nothing only
 * when the query has nothing else).
 */
export function match(p: Profile, q: Query): Match | null {
  if (q.empty) return { score: 0, why: [] };
  let score = 0;
  const why: string[] = [];

  if (q.bpm) {
    if (p.bpm === null) return null;
    const fit = tempoFit(p.bpm, q.bpm);
    if (!fit) return null;
    score += fit === "exact" ? 3 : 1.5;
    why.push(fit === "exact" ? `${p.bpm} BPM` : `${p.bpm} BPM, half or double time`);
  }
  if (q.key) {
    if (!p.key) return null;
    if (sameKey(p.key, q.key)) {
      score += 3;
      why.push(formatKey(p.key));
    } else if (compatibleKeys(q.key).some((k) => sameKey(k, p.key!))) {
      score += 1;
      why.push(`${formatKey(p.key)}, mixes with ${formatKey(q.key)}`);
    } else return null;
  }
  if (q.genres.length) {
    const g = q.genres.filter((x) => p.genres.includes(x));
    if (!g.length) return null;
    score += 2 * g.length;
    why.push(...g);
  }
  if (q.sounds.length) {
    const s = q.sounds.filter((x) => p.sounds.includes(x));
    if (!s.length) return null;
    score += 2 * s.length;
    why.push(...s);
  }
  for (const m of q.moods) {
    if (p.moods.includes(m)) {
      score += 1.5;
      why.push(m);
    }
  }
  for (const st of q.styles) {
    if (p.people.some((x) => st.aliases.some((a) => x.includes(a)))) {
      score += 6;
      why.push(`By ${st.name}`);
      continue;
    }
    // A style needs its genre: a piano ballad is not "like Metro" because it has a piano.
    const genre = st.genres.filter((x) => p.genres.includes(x)).length;
    const fit = genre ? genre * 2 + st.sounds.filter((x) => p.sounds.includes(x)).length + st.moods.filter((x) => p.moods.includes(x)).length : 0;
    if (fit > 0) {
      score += fit;
      why.push(`${st.name} style`);
    }
  }
  let wordHits = 0;
  for (const w of q.words) {
    if (p.text.includes(w)) {
      wordHits++;
      score += p.title.toLowerCase().includes(w) ? 2 : 1;
    }
  }
  const narrowed = q.bpm || q.key || q.genres.length || q.sounds.length;
  // Moods and styles alone still need something in common; words alone need a word.
  if (!narrowed && score === 0) return null;
  if (!narrowed && q.words.length && !wordHits && !q.moods.length && !q.styles.length) return null;
  return { score, why };
}

/** How alike two sounds are, for "more like this": genre, key, tempo, then sound and mood. */
export function likeness(a: Profile, b: Profile): Match {
  let score = 0;
  const why: string[] = [];
  const g = a.genres.filter((x) => b.genres.includes(x));
  if (g.length) {
    score += 3 * g.length;
    why.push(...g);
  }
  if (a.key && b.key) {
    if (sameKey(a.key, b.key)) {
      score += 3;
      why.push(`Same key, ${formatKey(b.key)}`);
    } else if (compatibleKeys(a.key).some((k) => sameKey(k, b.key!))) {
      score += 2;
      why.push(`${formatKey(b.key)} mixes with it`);
    }
  }
  if (a.bpm && b.bpm) {
    if (Math.abs(a.bpm - b.bpm) <= 4) {
      score += 2;
      why.push(`${b.bpm} BPM`);
    } else if (Math.abs(a.bpm * 2 - b.bpm) <= 4 || Math.abs(a.bpm - b.bpm * 2) <= 4) {
      score += 1;
      why.push(`${b.bpm} BPM, half or double time`);
    }
  }
  const s = a.sounds.filter((x) => b.sounds.includes(x)).slice(0, 3);
  score += s.length;
  why.push(...s);
  const m = a.moods.filter((x) => b.moods.includes(x)).slice(0, 2);
  score += m.length;
  why.push(...m);
  return { score, why };
}

/** The `count` most alike to `of`, best first, leaving out `of` itself and anything with nothing in common. */
export function moreLike<T extends { profile: Profile }>(of: Profile, pool: T[], count = 12): (T & { match: Match })[] {
  return pool
    .filter((x) => x.profile.id !== of.id)
    .map((x) => ({ ...x, match: likeness(of, x.profile) }))
    .filter((x) => x.match.score >= 3)
    .sort((a, b) => b.match.score - a.match.score || b.profile.publishedAt.localeCompare(a.profile.publishedAt))
    .slice(0, count);
}

/** Ranks by downloads per play, with a prior so a sound with two plays and one download does not top the list. */
export function quality(downloads: number, plays: number): number {
  return (downloads + 1) / (plays + 8);
}
