import { ALL_SONGS, isUnknown, producersOf, slugify, type Song } from "../presets/songs";
import { SAMPLE_CREDITS } from "../samples/credits";
import { SONG_CHORDS } from "../midi/songs";
import KIT_LIBRARY from "../kits/library.json";

/**
 * Producer pages: one page per producer ("Metro Boomin", "Pi'erre Bourne") that gathers everything
 * on Stash tied to them. Credits come from three places that spell names differently (presets,
 * sample credits, song chords), so names go through one alias table and a loose key. Loops and drum
 * kits made "in the style of" a producer join the page too, always labelled as Stash's own sounds.
 *
 * Only names a page can be sure of get one: a surname alone in the liner notes ("West", "Dean") is
 * skipped unless the alias table says who it is.
 */

/** Lowercase letters and digits only: "Pi'erre Bourne", "PIERRE BOURNE" and "pierre-bourne" are one. */
export const looseKey = (x: string) =>
  x
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/^the /, "")
    .replace(/[^a-z0-9]/g, "");

/** How the best-known producers are spelled, and the other spellings that mean them. */
const CANON: { name: string; aliases: string[] }[] = [
  { name: "Metro Boomin", aliases: ["metro boomin", "metro"] },
  { name: "Pi'erre Bourne", aliases: ["pierre bourne", "pi'erre bourne", "pierre"] },
  { name: "Southside", aliases: ["southside", "southside 808 mafia"] },
  { name: "Wheezy", aliases: ["wheezy", "wheezy outta here"] },
  { name: "Zaytoven", aliases: ["zaytoven", "zay"] },
  { name: "TM88", aliases: ["tm88", "tm 88"] },
  { name: "Tay Keith", aliases: ["tay keith"] },
  { name: "Lex Luger", aliases: ["lex luger"] },
  { name: "London on da Track", aliases: ["london on da track", "london on tha track"] },
  { name: "Nick Mira", aliases: ["nick mira"] },
  { name: "CuBeatz", aliases: ["cubeatz"] },
  { name: "F1LTHY", aliases: ["f1lthy", "filthy"] },
  { name: "AXL Beats", aliases: ["axl beats", "axl", "ax"] },
  { name: "808Melo", aliases: ["808melo", "808 melo"] },
  { name: "Mustard", aliases: ["mustard", "dj mustard"] },
  { name: "Mike WiLL Made-It", aliases: ["mike will made-it", "mike will made it", "mike will"] },
  { name: "Mike Dean", aliases: ["mike dean", "m. dean", "m dean"] },
  { name: "Kanye West", aliases: ["kanye west", "kanye", "ye"] },
  { name: "Dr. Dre", aliases: ["dr. dre", "dr dre"] },
  { name: "Tyler, the Creator", aliases: ["tyler, the creator", "tyler the creator"] },
  { name: "The Alchemist", aliases: ["the alchemist", "alchemist", "alc"] },
  { name: "DJ Premier", aliases: ["dj premier", "premier", "premo"] },
  { name: "J Dilla", aliases: ["j dilla", "dilla", "jay dee"] },
  { name: "Pete Rock", aliases: ["pete rock"] },
  { name: "Madlib", aliases: ["madlib"] },
  { name: "9th Wonder", aliases: ["9th wonder"] },
  { name: "Nujabes", aliases: ["nujabes"] },
  { name: "Kaytranada", aliases: ["kaytranada"] },
  { name: "Timbaland", aliases: ["timbaland"] },
  { name: "The Neptunes", aliases: ["the neptunes", "neptunes"] },
  { name: "Pharrell Williams", aliases: ["pharrell williams", "pharrell"] },
  { name: "Boi-1da", aliases: ["boi-1da", "boi 1da"] },
  { name: "Hit-Boy", aliases: ["hit-boy", "hit boy"] },
  { name: "Murda Beatz", aliases: ["murda beatz"] },
  { name: "Turbo", aliases: ["turbo", "turbo the great"] },
  { name: "Outtatown", aliases: ["outtatown"] },
  { name: "Taurus", aliases: ["taurus"] },
  { name: "DJ Paul", aliases: ["dj paul"] },
  { name: "Juicy J", aliases: ["juicy j"] },
  { name: "Swizz Beatz", aliases: ["swizz beatz"] },
  { name: "Just Blaze", aliases: ["just blaze"] },
  { name: "No I.D.", aliases: ["no i.d.", "no id"] },
  { name: "40", aliases: ["40", "noah \"40\" shebib", "noah shebib"] },
  { name: "Sounwave", aliases: ["sounwave"] },
  { name: "DJ Dahi", aliases: ["dj dahi"] },
  { name: "Cardo", aliases: ["cardo", "cardo got wings"] },
  { name: "Frank Dukes", aliases: ["frank dukes"] },
  { name: "Vinylz", aliases: ["vinylz"] },
  { name: "Ronny J", aliases: ["ronny j"] },
  { name: "Working on Dying", aliases: ["working on dying"] },
];

const ALIAS = new Map<string, string>();
for (const c of CANON) for (const a of [c.name, ...c.aliases]) ALIAS.set(looseKey(a), c.name);

/** Short aliases ("metro", "ax", "zay") are fine in a style tag but too loose for a credit line. */
const LOOSE_ONLY = new Set(["metro", "ax", "axl", "zay", "alc", "ye", "kanye", "pierre", "premier", "premo", "pharrell"].map(looseKey));

/** A credit or style name as its page names it, or null when it can't be told apart from others. */
export function canonicalName(raw: string, from: "credit" | "style" | "preset"): string | null {
  // Credits scraped from wiki markup carry brackets, table cells and the odd sentence: keep names only.
  const name = raw.replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
  if (!name || isUnknown(name)) return null;
  if (/[|=[\]{}<>"“”()#]|\d:\d|^\W/.test(name) || name.length > 32 || name.split(" ").length > 4) return null;
  // A lowercase phrase is a sentence fragment ("backing vocals", "the Creator"), not a name.
  if (/^[a-z]/.test(name) && name.includes(" ")) return null;
  if (/[:;?*’/–]|^(ok|lincoln|burke)$/i.test(name)) return null;
  if (/\b(vocals?|guitars?|bass|keys|drums|production|producers?|chart(ed)?|featuring|hook|interview|single|remix|album|song|record|track|itunes|released?|however)\b/i.test(name)) return null;
  const k = looseKey(name);
  const hit = ALIAS.get(k);
  if (hit && (from !== "credit" || !LOOSE_ONLY.has(k) || name.length > 5)) return hit;
  if (from === "style") return null;
  // A sample credit needs a full name: "West" or "Dean" alone could be anyone.
  if (from === "credit" && !/\s|-|\d|^[A-Z0-9.]{2,}$/.test(name)) return null;
  if (/^(various|others?|uncredited|n\/a|tbd)$/i.test(name)) return null;
  return name;
}

/** "Hit-Boy, Rogét Chahayed & Wheezy (co-producers)" as page names. */
export function namesIn(credit: string | null | undefined, from: "credit" | "preset"): string[] {
  if (!credit) return [];
  const out = new Set<string>();
  for (const p of producersOf(credit)) {
    const n = canonicalName(p, from);
    if (n) out.add(n);
  }
  return [...out];
}

export type ProducerPage = {
  name: string;
  slug: string;
  /** Preset songs they produced. */
  presets: Song[];
  /** Songs they produced on the Samples tab, as places in SAMPLE_SONGS (the songs load with that tab). */
  samples: number[];
  /** Song-chord rows (by title|artist key) they produced; resolved to MIDI items on the page. */
  midiSongs: Set<string>;
  /** Style tags on loops that point here ("metro boomin", "ax"). */
  styleTags: Set<string>;
  /** How many loops carry one of those tags. */
  loopCount: number;
  /** Kit "inspired by" names that point here. */
  kitStyles: Set<string>;
};

const BY_NAME = new Map<string, ProducerPage>();
function page(name: string): ProducerPage {
  const k = looseKey(name);
  let p = BY_NAME.get(k);
  if (!p) {
    p = { name, slug: "", presets: [], samples: [], midiSongs: new Set(), styleTags: new Set(), loopCount: 0, kitStyles: new Set() };
    BY_NAME.set(k, p);
  }
  return p;
}

for (const s of ALL_SONGS) {
  const names = new Set(s.entries.flatMap((e) => namesIn(e.producer, "preset")));
  for (const n of names) page(n).presets.push(s);
}
for (const s of SAMPLE_CREDITS) {
  // The sample credits split "Tyler, the Creator" at its comma.
  const credits = s.producers.map((p) => (/^the Creator$/i.test(p.trim()) ? "Tyler, the Creator" : p));
  const names = new Set(credits.map((p) => canonicalName(p, "credit")).filter((n): n is string => !!n));
  for (const n of names) page(n).samples.push(s.index);
}

/** The key a song-chord row is filed under. */
export const midiSongKey = (song: string, artist: string) => `${looseKey(song)}|${looseKey(artist.split(/ feat\.? | ft\.? |,| & | x /i)[0] ?? artist)}`;

for (const c of SONG_CHORDS) for (const n of namesIn(c.producer, "preset")) page(n).midiSongs.add(midiSongKey(c.song, c.artist));

/** The page a loop's style tag or a kit's "inspired by" name points at, if that producer has one. */
export function styleTarget(tag: string): ProducerPage | null {
  const n = canonicalName(tag, "style") ?? tag;
  return BY_NAME.get(looseKey(n)) ?? null;
}

const total = (p: ProducerPage) => p.presets.length + p.samples.length + p.midiSongs.size + p.loopCount + p.kitStyles.size;

let ordered: ProducerPage[] | null = null;
/** Every producer with a page, most material first. Slugs are stable for a given data set. */
export function allProducers(): ProducerPage[] {
  if (ordered) return ordered;
  const list = [...BY_NAME.values()].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));
  const taken = new Set<string>();
  // Slugs are given in name order, so adding a song never renames someone else's page.
  for (const p of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
    const base = slugify(p.name) || "producer";
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    p.slug = slug;
  }
  ordered = list;
  return list;
}

export function producerBySlug(slug: string): ProducerPage | null {
  return allProducers().find((p) => p.slug === slug) ?? null;
}

/** The page for a credited name ("Metro Boomin", "metro boomin", "DJ Mustard"), if it has one. */
export function producerNamed(name: string): ProducerPage | null {
  allProducers();
  const n = canonicalName(name, "preset") ?? name;
  return BY_NAME.get(looseKey(n)) ?? null;
}

export const producerPageHref = (p: { slug: string }) => `/producer/${p.slug}`;

/** The link for a credited name, or null when the name has no page. */
export function hrefForProducer(name: string): string | null {
  const p = producerNamed(name);
  return p ? producerPageHref(p) : null;
}

for (const k of KIT_LIBRARY.kits) if (k.inspiredBy) styleTarget(k.inspiredBy)?.kitStyles.add(k.inspiredBy);

/** Attaches loops' style tags (from the catalog, which the page builds at start). */
let stylesDone = false;
export function attachLoopStyles(loopTags: string[]) {
  if (stylesDone) return;
  stylesDone = true;
  for (const t of loopTags) {
    const p = styleTarget(t);
    if (!p) continue;
    p.styleTags.add(t.toLowerCase());
    p.loopCount++;
  }
  ordered = null;
}

export function producerTotal(p: ProducerPage): number {
  return total(p);
}
