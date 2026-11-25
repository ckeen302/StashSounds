import RAW from "./samples.json";
import { slugify, songKey } from "../presets/songs";

/**
 * The Samples tab's data: hip-hop and trap songs, the records each one samples, and where that is
 * documented. Every song cites the Wikipedia album article whose sample credits (from the liner
 * notes) name it. Nothing comes from WhoSampled. scripts/samples/build-samples.py notes how it was gathered.
 */

export type SampleType = "sample" | "interpolation";

export type SampleUse = {
  title: string;
  artist: string;
  year: number | null;
  genre: string;
  type: SampleType;
  /** The sampled record's own Wikipedia article, when it has one. */
  page: string | null;
};

export type SampleSource = { label: string; url: string };

export type SampleSong = {
  song: string;
  artist: string;
  year: number | null;
  album: string | null;
  producers: string[];
  samples: SampleUse[];
  sources: SampleSource[];
  slug: string;
  key: string;
};

/** A record that one or more songs here sample. */
export type Original = {
  title: string;
  artist: string;
  year: number | null;
  genre: string;
  slug: string;
  key: string;
  uses: { song: SampleSong; use: SampleUse }[];
};

const flat = (x: string) =>
  x
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^the /, "")
    .replace(/[^a-z0-9]/g, "");
const lead = (artist: string) =>
  (
    artist.split(/ feat\.? | ft\.? | x |,| & | and | with /i)[0] ?? artist
  ).trim();

export function originalKey(title: string, artist: string): string {
  return `${flat(title.replace(/\(.*?\)/g, ""))}|${flat(lead(artist))}`;
}

type RawSong = Omit<SampleSong, "slug" | "key">;

/** Merges rows for the same song (two agents may have found it) and drops empty ones. */
function build(): SampleSong[] {
  const by = new Map<string, SampleSong>();
  for (const r of RAW as RawSong[]) {
    if (!r.song || !r.artist || !r.samples?.length) continue;
    const key = songKey(r.song, r.artist);
    const had = by.get(key);
    if (had) {
      for (const u of r.samples)
        if (
          !had.samples.some(
            (x) =>
              originalKey(x.title, x.artist) === originalKey(u.title, u.artist),
          )
        )
          had.samples.push(u);
      for (const s of r.sources)
        if (!had.sources.some((x) => x.url === s.url)) had.sources.push(s);
      if (r.artist.length > had.artist.length) had.artist = r.artist;
      had.year ??= r.year;
      had.album ??= r.album;
      if (!had.producers.length) had.producers = r.producers;
      continue;
    }
    by.set(key, {
      ...r,
      producers: r.producers ?? [],
      album: r.album ?? null,
      year: r.year ?? null,
      sources: r.sources ?? [],
      samples: [...r.samples],
      key,
      slug: "",
    });
  }
  const songs = [...by.values()];
  const taken = new Set<string>();
  for (const s of songs) {
    const base = slugify(`${s.song} ${lead(s.artist)}`) || "song";
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    s.slug = slug;
  }
  return songs.sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.song.localeCompare(b.song),
  );
}

export const SAMPLE_SONGS: SampleSong[] = build();

function buildOriginals(): Original[] {
  const by = new Map<string, Original>();
  for (const s of SAMPLE_SONGS) {
    for (const u of s.samples) {
      const key = originalKey(u.title, u.artist);
      const o = by.get(key) ?? {
        title: u.title,
        artist: u.artist,
        year: u.year,
        genre: u.genre,
        key,
        slug: "",
        uses: [],
      };
      o.year ??= u.year;
      if (!o.uses.some((x) => x.song === s)) o.uses.push({ song: s, use: u });
      by.set(key, o);
    }
  }
  const list = [...by.values()];
  const taken = new Set<string>();
  for (const o of list) {
    const base = slugify(`${o.title} ${lead(o.artist)}`) || "record";
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    o.slug = slug;
    o.uses.sort((a, b) => (a.song.year ?? 0) - (b.song.year ?? 0));
  }
  return list.sort(
    (a, b) =>
      b.uses.length - a.uses.length || (a.year ?? 9999) - (b.year ?? 9999),
  );
}

export const ORIGINALS: Original[] = buildOriginals();
const ORIGINAL_BY_KEY = new Map(ORIGINALS.map((o) => [o.key, o]));
const ORIGINAL_BY_SLUG = new Map(ORIGINALS.map((o) => [o.slug, o]));
const SONG_BY_SLUG = new Map(SAMPLE_SONGS.map((s) => [s.slug, s]));

export const sampleSongBySlug = (slug: string) =>
  SONG_BY_SLUG.get(slug) ?? null;
export const originalBySlug = (slug: string) =>
  ORIGINAL_BY_SLUG.get(slug) ?? null;
export const originalOf = (u: SampleUse) =>
  ORIGINAL_BY_KEY.get(originalKey(u.title, u.artist))!;
export const sampleHref = (s: SampleSong) => `/samples/${s.slug}`;
export const originalHref = (o: Original) => `/sampled/${o.slug}`;

/** The genres of the sampled records, most common first. */
export const GENRES: [string, number][] = (() => {
  const n = new Map<string, number>();
  for (const s of SAMPLE_SONGS)
    for (const g of new Set(s.samples.map((u) => u.genre)))
      n.set(g, (n.get(g) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]);
})();

/** The decade a year falls in, as "1970s". */
export const decadeOf = (y: number | null) =>
  y ? `${Math.floor(y / 10) * 10}s` : null;

/** A YouTube search for a record, so a producer can hear the original. Opens outside the demo. */
export const listenHref = (title: string, artist: string) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${title}`)}`;
