import RAW from "./samples.json";
import { slugify, songKey } from "../presets/songs";

/**
 * The Samples tab's data: hip-hop and R&B songs, the records each one samples, and the links between
 * them both ways (what a song samples, and what sampled it). Every song cites the Wikipedia article
 * that names the sample: its album's sample credits (from the liner notes), or the song's own article.
 * Nothing comes from WhoSampled.
 * scripts/samples/build-samples.py writes samples.json; its header says how the credits were read.
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
  /** Its YouTube video, from Wikidata's "YouTube video ID" on the song's item. */
  video: string | null;
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
  /** Its YouTube video, from Wikidata, when the song has its own article there. */
  video: string | null;
  slug: string;
  key: string;
};

/** A record that one or more songs here sample. */
export type Original = {
  title: string;
  artist: string;
  year: number | null;
  genre: string;
  video: string | null;
  slug: string;
  key: string;
  uses: { song: SampleSong; use: SampleUse }[];
};

/** An artist on either side: songs of theirs that sample, and records of theirs that were sampled. */
export type SampleArtist = {
  name: string;
  slug: string;
  songs: SampleSong[];
  records: Original[];
  /** How many songs here sample one of their records. */
  sampledTimes: number;
};

export type SampleProducer = {
  name: string;
  slug: string;
  songs: SampleSong[];
};

const WIKI = "https://en.wikipedia.org/wiki/";
/** A row names a Wikipedia article by its title, or another open source (MusicBrainz, Wikidata) by its URL. */
const sourceUrl = (page: string) =>
  page.startsWith("https://") ? page : WIKI + page;

const flat = (x: string) =>
  x
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/^the /, "")
    .replace(/[^a-z0-9]/g, "");

/** "Kanye West feat. Jay-Z" is Kanye West. Names joined by "&" stay whole: "Kool & the Gang" is one act. */
export const leadArtist = (artist: string) =>
  (artist.split(/ feat\.? | featuring | ft\.? | with /i)[0] ?? artist).trim();

export function originalKey(title: string, artist: string): string {
  return `${flat(title.replace(/\(.*?\)/g, ""))}|${flat(leadArtist(artist))}`;
}

type Row = [
  string,
  string,
  number | null,
  string | null,
  string[],
  string,
  [string, string, number | null, string, number, string, string?][],
  string?,
];

function uniqueSlugs<T extends { slug: string }>(
  items: T[],
  base: (t: T) => string,
) {
  const taken = new Set<string>();
  for (const t of items) {
    const b = slugify(base(t)) || "x";
    let slug = b;
    for (let n = 2; taken.has(slug); n++) slug = `${b}-${n}`;
    taken.add(slug);
    t.slug = slug;
  }
}

/** Reads the compact rows and merges rows for the same song (an album and its deluxe edition). */
function build(): SampleSong[] {
  const by = new Map<string, SampleSong>();
  for (const [
    song,
    artist,
    year,
    album,
    credited,
    page,
    uses,
    video,
  ] of RAW as Row[]) {
    // Some credits keep their wiki link markup: "[[Metro Boomin]]", "[[Doughboy (producer)|Doughboy]]".
    const producers = credited
      .map((n) =>
        (
          n
            .replace(/\[\[|\]\]/g, "")
            .split("|")
            .pop() ?? n
        ).trim(),
      )
      .filter(Boolean);
    const samples: SampleUse[] = uses.map(([t, a, y, g, replayed, p, v]) => ({
      title: t,
      artist: a,
      year: y,
      genre: g,
      type: replayed ? "interpolation" : "sample",
      page: p ? sourceUrl(p) : null,
      video: v || null,
    }));
    if (!song || !artist || !samples.length) continue;
    const source = {
      label: page.startsWith("https://musicbrainz.org/")
        ? `MusicBrainz: ${song}, samples`
        : page.startsWith("https://www.wikidata.org/")
          ? `Wikidata: ${song}, samples from work`
          : `Wikipedia: ${decodeURIComponent(page).replace(/_/g, " ")}`,
      url: sourceUrl(page),
    };
    const key = songKey(song, artist);
    const had = by.get(key);
    if (had) {
      for (const u of samples)
        if (
          !had.samples.some(
            (x) =>
              originalKey(x.title, x.artist) === originalKey(u.title, u.artist),
          )
        )
          had.samples.push(u);
      if (!had.sources.some((x) => x.url === source.url))
        had.sources.push(source);
      had.year ??= year;
      had.album ??= album;
      had.video ??= video || null;
      if (!had.producers.length) had.producers = producers;
      continue;
    }
    by.set(key, {
      song,
      artist,
      year,
      album,
      producers,
      samples,
      sources: [source],
      video: video || null,
      key,
      slug: "",
    });
  }
  const songs = [...by.values()];
  uniqueSlugs(songs, (s) => `${s.song} ${leadArtist(s.artist)}`);
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
        video: u.video,
        key,
        slug: "",
        uses: [],
      };
      o.year ??= u.year;
      o.video ??= u.video;
      if (o.genre === "Other" && u.genre !== "Other") o.genre = u.genre;
      if (!o.uses.some((x) => x.song === s)) o.uses.push({ song: s, use: u });
      by.set(key, o);
    }
  }
  const list = [...by.values()];
  uniqueSlugs(list, (o) => `${o.title} ${leadArtist(o.artist)}`);
  for (const o of list)
    o.uses.sort((a, b) => (a.song.year ?? 0) - (b.song.year ?? 0));
  return list.sort(
    (a, b) =>
      b.uses.length - a.uses.length || (a.year ?? 9999) - (b.year ?? 9999),
  );
}

export const ORIGINALS: Original[] = buildOriginals();
const ORIGINAL_BY_KEY = new Map(ORIGINALS.map((o) => [o.key, o]));
const ORIGINAL_BY_SLUG = new Map(ORIGINALS.map((o) => [o.slug, o]));
const SONG_BY_SLUG = new Map(SAMPLE_SONGS.map((s) => [s.slug, s]));
const SONG_BY_OKEY = new Map(
  SAMPLE_SONGS.map((s) => [originalKey(s.song, s.artist), s]),
);

export const sampleSongBySlug = (slug: string) =>
  SONG_BY_SLUG.get(slug) ?? null;
export const originalBySlug = (slug: string) =>
  ORIGINAL_BY_SLUG.get(slug) ?? null;
export const originalOf = (u: SampleUse) =>
  ORIGINAL_BY_KEY.get(originalKey(u.title, u.artist))!;
// A song that is also a sampled record shares its video both ways.
for (const s of SAMPLE_SONGS) {
  const o = ORIGINAL_BY_KEY.get(originalKey(s.song, s.artist));
  if (o) {
    s.video ??= o.video;
    o.video ??= s.video;
  }
}

/** The same recording seen as a sampled record: who sampled this song. */
export const asOriginal = (s: SampleSong) =>
  ORIGINAL_BY_KEY.get(originalKey(s.song, s.artist)) ?? null;
/** The same recording seen as a song here: what this sampled record itself samples. */
export const asSong = (o: Original) => SONG_BY_OKEY.get(o.key) ?? null;

export const sampleHref = (s: SampleSong) => `/samples/${s.slug}`;
export const originalHref = (o: Original) => `/sampled/${o.slug}`;
export const artistHref = (a: SampleArtist) => `/samples-artist/${a.slug}`;
export const producerHref = (p: SampleProducer) =>
  `/samples-producer/${p.slug}`;

function buildArtists(): SampleArtist[] {
  const by = new Map<string, SampleArtist>();
  const get = (name: string) => {
    const lead = leadArtist(name);
    const k = flat(lead);
    const a = by.get(k) ?? {
      name: lead,
      slug: "",
      songs: [],
      records: [],
      sampledTimes: 0,
    };
    by.set(k, a);
    return a;
  };
  for (const s of SAMPLE_SONGS) get(s.artist).songs.push(s);
  for (const o of ORIGINALS) {
    const a = get(o.artist);
    a.records.push(o);
    a.sampledTimes += o.uses.length;
  }
  const list = [...by.values()].filter((a) => a.name);
  uniqueSlugs(list, (a) => a.name);
  return list.sort(
    (a, b) =>
      b.sampledTimes - a.sampledTimes || b.songs.length - a.songs.length,
  );
}

export const ARTISTS: SampleArtist[] = buildArtists();
const ARTIST_BY_SLUG = new Map(ARTISTS.map((a) => [a.slug, a]));
const ARTIST_BY_FLAT = new Map(ARTISTS.map((a) => [flat(a.name), a]));
export const artistBySlug = (slug: string) => ARTIST_BY_SLUG.get(slug) ?? null;
export const artistOf = (name: string) =>
  ARTIST_BY_FLAT.get(flat(leadArtist(name))) ?? null;

function buildProducers(): SampleProducer[] {
  const by = new Map<string, SampleProducer>();
  for (const s of SAMPLE_SONGS)
    for (const name of s.producers) {
      // The liner notes often give a surname only ("West", "Dean"); those can't be told apart, so only full names get a page.
      if (!/\s|-|\d|^[A-Z0-9]{2,}$/.test(name)) continue;
      const k = flat(name);
      const p = by.get(k) ?? { name, slug: "", songs: [] };
      if (!p.songs.includes(s)) p.songs.push(s);
      by.set(k, p);
    }
  const list = [...by.values()].filter((p) => p.songs.length > 1);
  uniqueSlugs(list, (p) => p.name);
  return list.sort((a, b) => b.songs.length - a.songs.length);
}

export const PRODUCERS: SampleProducer[] = buildProducers();
const PRODUCER_BY_SLUG = new Map(PRODUCERS.map((p) => [p.slug, p]));
const PRODUCER_BY_FLAT = new Map(PRODUCERS.map((p) => [flat(p.name), p]));
export const producerBySlug = (slug: string) =>
  PRODUCER_BY_SLUG.get(slug) ?? null;
export const producerOf = (name: string) =>
  PRODUCER_BY_FLAT.get(flat(name)) ?? null;

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

/**
 * Where to hear a recording on YouTube: its own video when Wikidata names one, otherwise a search.
 * Opens outside the demo.
 */
export const listenHref = (
  title: string,
  artist: string,
  video?: string | null,
) =>
  video
    ? `https://www.youtube.com/watch?v=${video}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${leadArtist(artist)} ${title}`)}`;

/** The button text for listenHref: a video plays, a search finds. */
export const listenLabel = (video?: string | null) =>
  video ? "Play on YouTube" : "Find on YouTube";
