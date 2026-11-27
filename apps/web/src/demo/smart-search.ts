import type { MusicalKey } from "@stash/contracts";
import { compatibleKeys, formatKey } from "@stash/contracts/format";
import { expandNicknames, fold, termHit, terms } from "./text-match";

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
  ["Drums", ["drums", "drum", "hats", "hat", "hi hats", "hi hat", "hi-hat", "hi-hats", "hihat", "hihats", "hh", "open hat", "closed hat", "snare", "snares", "kick", "kicks", "clap", "claps", "rim", "rimshot", "tom", "toms", "crash", "cymbal", "ride", "perc", "percussion", "rolls", "hat rolls"]],
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
  // Artists producers name when they mean "in the style of" ("carti type beat"). Their songs in the
  // MIDI library rank first; loops of the same genre and sound follow.
  { name: "Playboi Carti", aliases: ["playboi carti", "playboy carti", "carti", "whole lotta red"], genres: ["Rage", "Plugg"], sounds: ["Synth", "Lead", "808", "Bells"], moods: ["Hard", "Bouncy"] },
  { name: "Ken Carson", aliases: ["ken carson", "opium"], genres: ["Rage"], sounds: ["Synth", "Lead", "808"], moods: ["Hard", "Dark"] },
  { name: "Destroy Lonely", aliases: ["destroy lonely"], genres: ["Rage"], sounds: ["Synth", "Pad", "808"], moods: ["Dark", "Dreamy"] },
  { name: "Gunna", aliases: ["gunna"], genres: ["Trap"], sounds: ["Guitar", "Pluck", "808"], moods: ["Bouncy", "Chill"] },
  { name: "Yeat", aliases: ["yeat"], genres: ["Rage"], sounds: ["Bells", "Synth", "808"], moods: ["Hard"] },
  { name: "Lil Uzi Vert", aliases: ["lil uzi vert", "lil uzi", "uzi"], genres: ["Rage", "Trap"], sounds: ["Synth", "Lead", "Bells"], moods: ["Bouncy", "Happy"] },
  { name: "Travis Scott", aliases: ["travis scott", "travis", "la flame", "cactus jack"], genres: ["Trap"], sounds: ["Synth", "Pad", "808", "Bells"], moods: ["Dark", "Dreamy"] },
  { name: "Future", aliases: ["future", "pluto"], genres: ["Trap"], sounds: ["808", "Bells", "Piano", "Synth"], moods: ["Dark"] },
  { name: "21 Savage", aliases: ["21 savage"], genres: ["Trap"], sounds: ["808", "Piano", "Strings"], moods: ["Dark"] },
  { name: "Young Thug", aliases: ["young thug", "thugger"], genres: ["Trap"], sounds: ["Guitar", "Pluck", "808"], moods: ["Bouncy"] },
  { name: "Gucci Mane", aliases: ["gucci mane", "gucci"], genres: ["Trap"], sounds: ["Piano", "Keys", "808"], moods: ["Bouncy"] },
  { name: "Chief Keef", aliases: ["chief keef", "sosa"], genres: ["Drill", "Trap"], sounds: ["Brass", "Strings", "Bells", "808"], moods: ["Hard", "Dark"] },
  { name: "Pop Smoke", aliases: ["pop smoke"], genres: ["Drill"], sounds: ["808", "Choir", "Strings"], moods: ["Dark", "Hard"] },
  { name: "Drake", aliases: ["drake", "drizzy", "ovo"], genres: ["R&B", "Trap"], sounds: ["Pad", "Keys", "Piano"], moods: ["Chill", "Dreamy", "Sad"] },
  { name: "The Weeknd", aliases: ["the weeknd", "weeknd", "the weekend"], genres: ["R&B"], sounds: ["Synth", "Pad"], moods: ["Dark", "Dreamy"] },
  { name: "Juice WRLD", aliases: ["juice wrld", "juice world"], genres: ["Trap"], sounds: ["Guitar", "Piano", "Melody"], moods: ["Sad"] },
  { name: "Kanye West", aliases: ["kanye west", "kanye", "yeezy", "ye"], genres: ["Soul", "Boom bap"], sounds: ["Choir", "Keys", "Piano"], moods: ["Dusty"] },
  { name: "Tyler, the Creator", aliases: ["tyler the creator", "tyler"], genres: ["Soul", "R&B"], sounds: ["Keys", "Synth", "Chords"], moods: ["Jazzy", "Bouncy"] },
  { name: "Kendrick Lamar", aliases: ["kendrick lamar", "kendrick"], genres: ["West Coast", "Boom bap"], sounds: ["Keys", "Piano", "Drums"], moods: ["Jazzy", "Hard"] },
];

// Every word in a named style ("metro", "boomin", "carti"), for forgiving one typo in a long one.
const STYLE_WORDS = [...new Set(STYLES.flatMap((s) => s.aliases.flatMap((a) => a.split(" "))).filter((w) => w.length >= 5 && /^[a-z]+$/.test(w)))];

function nearOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
      // A swap of two letters ("tarvis") counts as one typo.
      i += 2;
      j += 2;
    } else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** "trvis" -> "travis", "boomim" -> "boomin": a word one typo off a producer's or artist's name. */
function styleSpelling(w: string): string | null {
  if (w.length < 5 || STYLE_WORDS.includes(w)) return null;
  return STYLE_WORDS.find((x) => nearOne(w, x)) ?? null;
}

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
    // "140s" is a tempo; "90s" and "80s" are an era ("90s boom bap"), so those stay words.
    if (a < 100 || a > 240 || a % 10) return null;
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
  // Fix a typo in a long word of a name ("trvis scott", "metro boomim"), keeping the typed word as
  // the token's raw text so its chip can still remove it. Same-length swaps keep offsets in place.
  const typed = new Map<string, string>();
  rest = rest.replace(/[a-z]{5,}/g, (w) => {
    const fix = styleSpelling(w);
    if (!fix) return w;
    typed.set(fix, w);
    return fix;
  });
  const rawOf = (text: string) => text.replace(/[a-z]+/g, (w) => typed.get(w) ?? w);
  for (const p of phrases) {
    take(new RegExp(`(?<![\\w&'])${esc(p.alias)}(?![\\w&'])`), (m) => {
      const label = p.apply();
      return tokens.some((t) => t.kind === p.kind && t.label === label) ? null : { kind: p.kind, label, raw: rawOf(m[0].trim()) };
    });
  }

  const words = [
    ...new Set(
      rest
        .split(/\s+/)
        .map((w) => w.replace(/^[^\w#&]+|[^\w#&]+$/g, ""))
        .filter((w) => w.length > 1 && !STOP.has(w))
        .flatMap((w) => fold(w).split(" "))
        .filter((w) => w.length > 1 && !STOP.has(w)),
    ),
  ];
  // A nickname ("hov", "weezy") searches as the name it stands for; its chip still removes what was typed.
  const named: string[] = [];
  for (const w of words) {
    const name = expandNicknames(w);
    tokens.push({ kind: "word", label: `“${name}”`, raw: w });
    for (const x of name.split(" ")) if (!named.includes(x)) named.push(x);
  }
  words.splice(0, words.length, ...named);

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
  /** The text's words and the title's, folded, for word matching. */
  terms: string[];
  titleTerms: string[];
};

// One compiled pattern per name (any of its aliases, as a whole word), built once: compiling a new
// RegExp for every alias of every item made indexing the catalog the slowest part of opening a tab.
const compiled = new WeakMap<[string, string[]][], [string, RegExp][]>();
function hits(aliases: [string, string[]][], text: string): string[] {
  let list = compiled.get(aliases);
  if (!list) {
    list = aliases.filter(([, as]) => as.length > 0).map(([n, as]) => [n, new RegExp(`(?<![\\w&'])(?:${as.map(esc).join("|")})(?![\\w&'])`)]);
    compiled.set(aliases, list);
  }
  return list.filter(([, re]) => re.test(text)).map(([n]) => n);
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
    terms: terms(p.words.join(" ")),
    titleTerms: terms(p.title),
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

/** `all` is false when some plain word of the query matched nothing: a close match, not an answer. */
export type Match = { score: number; why: string[]; all?: boolean };

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
    const inTitle = termHit(p.titleTerms, w);
    const hit = inTitle || termHit(p.terms, w);
    if (hit) {
      wordHits++;
      score += (inTitle ? 2 : 1) * (hit === 1 ? 0.5 : 1);
    }
  }
  const narrowed = q.bpm || q.key || q.genres.length || q.sounds.length;
  // Moods and styles alone still need something in common; words alone need a word.
  if (!narrowed && score === 0) return null;
  if (!narrowed && q.words.length && !wordHits && !q.moods.length && !q.styles.length) return null;
  return { score, why, all: wordHits === q.words.length };
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

// ---------------------------------------------------------------------------------------------
// Vibes for things that have no tags of their own (songs, drum kits): the genres, moods and sounds
// the artist or producer behind them is known for, by the same table "like metro" reads.

const ALIASES_OF = new Map<string, string[]>([...GENRE_ALIASES, ...SOUND_ALIASES, ...MOOD_ALIASES].map(([n, as]) => [n as string, as]));

// Every style by its folded name and its longer aliases, built once (the search asks per song).
let STYLE_BY_NAME: Map<string, (typeof STYLES)[number]> | null = null;
function styleByName() {
  if (STYLE_BY_NAME) return STYLE_BY_NAME;
  const m = new Map<string, (typeof STYLES)[number]>();
  for (const x of STYLES) if (!m.has(fold(x.name))) m.set(fold(x.name), x);
  for (const x of STYLES) for (const a of x.aliases) if (a.length > 4 && !m.has(fold(a))) m.set(fold(a), x);
  return (STYLE_BY_NAME = m);
}

/** The style labels ("Trap", "Dark", "808") of the artists and producers named. */
export function vibeOf(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const k = fold(n);
    if (!k) continue;
    const st = styleByName().get(k);
    if (!st) continue;
    for (const l of [...st.genres, ...st.moods, ...st.sounds]) out.add(l);
  }
  return [...out];
}

/** Labels with every word producers use for them, as text to match a search against ("Dark" brings "evil", "eerie"...). */
export function vibeText(labels: string[]): string {
  return labels.flatMap((l) => [l, ...(ALIASES_OF.get(l) ?? [])]).join(" ");
}
