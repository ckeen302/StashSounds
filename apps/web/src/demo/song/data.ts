import { songChordItems, type MidiItem } from "../midi/catalog";
import { canonicalName, looseKey } from "../producers/data";
import { ALL_SONGS, isUnknown, producersOf, songBySlug, songSlug, type Song } from "../presets/songs";
import { kits, type Kit } from "../kits/store";
import { asOriginal, SAMPLE_SONGS, sampleSongBySlug, type SampleSong, type SampleUse } from "../samples/data";

/**
 * One page per song. The presets, the samples, the chords and the drum kit for a song live in four
 * libraries that each spell the song their own way; this file files them under one key per song
 * (its title without the bracketed part, and its lead artist) and gives each song one address,
 * `/song/<slug>`. It loads with the Samples catalog, not with the first page.
 */

export type SongAll = {
  key: string;
  slug: string;
  song: string;
  artist: string;
  album: string | null;
  year: number | null;
  producers: string[];
  video: string | null;
  preset: Song | null;
  sample: SampleSong | null;
  /** Songs here that sample this one. */
  sampledIn: { song: SampleSong; use: SampleUse }[];
  /** This song's chord charts in the MIDI library. */
  chords: MidiItem[];
};

/** "XO Tour Llif3", "XO TOUR Llif3" and "XO Tour Llif3 (Remix)" by "Lil Uzi Vert feat. X" are one song. */
export function matchKey(song: string, artist: string): string {
  const title = song.replace(/\s*[([].*?[)\]]\s*/g, " ").trim() || song;
  const lead = artist.split(/ feat\.? | featuring | ft\.? | with | x |,| & | \(/i)[0] ?? artist;
  return `${looseKey(title)}|${looseKey(lead)}`;
}

const BY_KEY = new Map<string, SongAll>();
const BY_SLUG = new Map<string, SongAll>();
/** Every slug a song has gone by (its Presets or Samples slug, its plain title slug), to the song. */
const ALIAS = new Map<string, SongAll>();

function entry(song: string, artist: string): SongAll {
  const key = matchKey(song, artist);
  let s = BY_KEY.get(key);
  if (!s) {
    s = { key, slug: "", song, artist, album: null, year: null, producers: [], video: null, preset: null, sample: null, sampledIn: [], chords: [] };
    BY_KEY.set(key, s);
  }
  // The fuller credit wins: "Travis Scott feat. Drake" over "Travis Scott".
  if (artist.length > s.artist.length) s.artist = artist;
  return s;
}

function addProducers(s: SongAll, names: string[]) {
  for (const n of names) {
    if (isUnknown(n)) continue;
    if (!s.producers.some((p) => looseKey(p) === looseKey(n))) s.producers.push(n);
  }
}

for (const p of ALL_SONGS) {
  const s = entry(p.song, p.artist);
  s.preset ??= p;
  s.song = p.song;
  s.album ??= p.album && p.album !== "Single" ? p.album : null;
  addProducers(s, producersOf(p.producer));
}
// Versions of one song ("Let Me Ride", "Let Me Ride (Extended Club Mix)") are one page: the plain
// title leads, and every version's address and the songs that sample it land there.
const VERSIONS = new Map<SongAll, SampleSong[]>();
const bracketed = (t: string) => /[([]/.test(t);
for (const x of SAMPLE_SONGS) {
  const s = entry(x.song, x.artist);
  VERSIONS.set(s, [...(VERSIONS.get(s) ?? []), x]);
  if (!s.sample || (bracketed(s.sample.song) && !bracketed(x.song))) {
    s.sample = x;
    if (!s.preset) s.song = x.song;
  }
  s.album ??= x.album;
  s.year ??= x.year;
  s.video ??= x.video;
  addProducers(s, x.producers.filter((n) => canonicalName(n, "credit")));
  for (const u of asOriginal(x)?.uses ?? []) if (!s.sampledIn.some((y) => y.song === u.song)) s.sampledIn.push(u);
}
for (const m of songChordItems()) {
  if (!m.song) continue;
  const s = entry(m.song.song, m.song.artist);
  s.chords.push(m);
  if (m.song.producer) addProducers(s, producersOf(m.song.producer));
}

// Addresses: a song on the Presets tab keeps the slug it had there, so old links land on the same
// song; the rest take their title-and-artist slug, numbered when two songs would share one.
const ALL: SongAll[] = [...BY_KEY.values()];
for (const s of ALL) {
  if (s.preset) {
    s.slug = s.preset.slug;
    BY_SLUG.set(s.slug, s);
  }
}
for (const s of ALL) {
  if (s.preset) continue;
  const base = s.sample?.slug ?? songSlug(s.song, s.artist);
  let slug = base;
  for (let n = 2; BY_SLUG.has(slug); n++) slug = `${base}-${n}`;
  s.slug = slug;
  BY_SLUG.set(slug, s);
}
for (const s of ALL) {
  const versions = VERSIONS.get(s) ?? [];
  for (const a of [...versions.map((x) => x.slug), songSlug(s.song, s.artist)]) if (a && !BY_SLUG.has(a) && !ALIAS.has(a)) ALIAS.set(a, s);
  for (const x of versions) x.songSlug = s.slug;
}

export const SONGS: SongAll[] = ALL;

export const songAllHref = (s: { slug: string }) => `/song/${s.slug}`;

/** The song at /song/<slug>, by its own slug or one it went by. */
export function songAllBySlug(slug: string): SongAll | null {
  return BY_SLUG.get(slug) ?? ALIAS.get(slug) ?? null;
}

/** The song behind an old /presets/<slug> address. */
export function songFromPreset(slug: string): SongAll | null {
  const p = songBySlug(slug);
  return p ? (BY_KEY.get(matchKey(p.song, p.artist)) ?? null) : null;
}

/** The song behind an old /samples/<slug> address. */
export function songFromSample(slug: string): SongAll | null {
  const x = sampleSongBySlug(slug);
  return x ? (BY_KEY.get(matchKey(x.song, x.artist)) ?? null) : null;
}

export function songAllOf(song: string, artist: string): SongAll | null {
  return BY_KEY.get(matchKey(song, artist)) ?? null;
}

/** What the page has for a song, in the order it shows them. */
export function partsOf(s: SongAll): ("samples" | "presets" | "chords" | "drums")[] {
  return [
    ...(s.sample || s.sampledIn.length ? (["samples"] as const) : []),
    ...(s.preset ? (["presets"] as const) : []),
    ...(s.chords.length ? (["chords"] as const) : []),
    "drums" as const,
  ];
}

/**
 * Artists whose sound is tied to one of the kits' producers, by lead artist. Only pairings the
 * public record makes (who produced their best-known songs); a song by anyone else falls to its
 * genre.
 */
const ARTIST_STYLE: Record<string, string> = {
  playboicarti: "Pi'erre Bourne",
  liluzivert: "Pi'erre Bourne",
  youngnudy: "Pi'erre Bourne",
  trippieredd: "Pi'erre Bourne",
  kencarson: "F1lthy",
  destroylonely: "F1lthy",
  homixidegang: "F1lthy",
  future: "Southside",
  "21savage": "Metro Boomin",
  travisscott: "Metro Boomin",
  metroboomin: "Metro Boomin",
  nav: "Metro Boomin",
  youngthug: "Wheezy",
  gunna: "Wheezy",
  lilbaby: "Wheezy",
  "808mafia": "Southside",
  moneybaggyo: "Tay Keith",
  blacyoungsta: "Tay Keith",
  glorilla: "Tay Keith",
  "42dugg": "Tay Keith",
};

export type KitPick = { kit: Kit; why: string };

/**
 * The drum kit to start this song's drums from: a kit made in the style of a producer on the song,
 * then the producer behind the artist's sound, then the trap kit. Every kit is Stash's own sounds,
 * never stems from the record, and the reason says which match it was.
 */
export function kitFor(s: SongAll): KitPick | null {
  const all = kits().filter((k) => k.inspiredBy);
  if (!all.length) return null;
  const styleKey = (k: Kit) => looseKey(canonicalName(k.inspiredBy!, "style") ?? k.inspiredBy!);
  for (const p of s.producers) {
    const k = looseKey(canonicalName(p, "preset") ?? p);
    const hit = all.find((x) => styleKey(x) === k);
    if (hit) return { kit: hit, why: `Made in the style of ${hit.inspiredBy}, who produced this song.` };
  }
  const lead = looseKey(s.artist.split(/ feat\.? | featuring | ft\.? | with | x |,| & /i)[0] ?? s.artist);
  const style = ARTIST_STYLE[lead];
  const byArtist = style ? all.find((x) => styleKey(x) === looseKey(style)) : undefined;
  if (byArtist) return { kit: byArtist, why: `In the style of ${byArtist.inspiredBy}, the sound behind a lot of ${s.artist.split(/ feat\.? | ft\.? |,| & /i)[0]}'s songs.` };
  const trap = all.find((x) => /trap/i.test(x.genre)) ?? all[0]!;
  return { kit: trap, why: "A starting point: none of our kits is tied to this song's producers." };
}
