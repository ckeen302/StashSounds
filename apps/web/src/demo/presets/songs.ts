import { PRESETS, type Confidence, type PresetEntry } from "./data";

/** The preset rows grouped into songs, plus the names, slugs and links that hang off a song. */

export const LEVEL: Record<Confidence, number> = { producer: 4, engineer: 3, press: 2, community: 1 };

export type Song = { key: string; slug: string; song: string; artist: string; producer: string; album?: string; entries: PresetEntry[]; best: number; named: number };

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function songSlug(song: string, artist: string): string {
  return slugify(`${song} ${artist.split(/ feat\.? | ft\.? | x |,| & /i)[0] ?? artist}`);
}

/** One key per song however its title is cased or punctuated, by its lead artist. */
export function songKey(song: string, artist: string): string {
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${flat(song)}|${flat(artist.split(/ feat\.? | ft\.? | x |,| & | \(/i)[0] ?? artist)}`;
}

/** Groups rows into songs, surest sound first inside each song. */
export function groupSongs(rows: PresetEntry[]): Song[] {
  const by = new Map<string, Song>();
  for (const e of rows) {
    // "Drunk In Love | Beyoncé" and "Drunk in Love | Beyoncé feat. Jay-Z" are one song.
    const key = songKey(e.song, e.artist);
    const s = by.get(key) ?? { key, slug: songSlug(e.song, e.artist), song: e.song, artist: e.artist, producer: e.producer, entries: [], best: 0, named: 0 };
    if (e.artist.length > s.artist.length) s.artist = e.artist;
    if (!s.album && e.album) s.album = e.album;
    s.entries.push(e);
    s.best = Math.max(s.best, LEVEL[e.confidence]);
    if (e.preset) s.named++;
    if (isUnknown(s.producer) && !isUnknown(e.producer)) s.producer = e.producer;
    by.set(key, s);
  }
  for (const s of by.values()) s.entries.sort((a, b) => LEVEL[b.confidence] - LEVEL[a.confidence] || Number(!!b.preset) - Number(!!a.preset));
  return [...by.values()];
}

export const ALL_SONGS: Song[] = groupSongs(PRESETS);

/** Two songs can share a slug (same title, same lead artist); the first keeps it, later ones get -2, -3. */
const BY_SLUG = new Map<string, Song>();
for (const s of ALL_SONGS) {
  let slug = s.slug;
  for (let n = 2; BY_SLUG.has(slug); n++) slug = `${s.slug}-${n}`;
  s.slug = slug;
  BY_SLUG.set(slug, s);
}

export function songBySlug(slug: string): Song | null {
  return BY_SLUG.get(slug) ?? null;
}

export function isUnknown(p: string | null | undefined): boolean {
  return !p || /^(unknown|not (named|stated|credited)|n\/a)/i.test(p.trim());
}

/** "Hit-Boy, Rogét Chahayed & Wheezy (co-producers)" becomes ["Hit-Boy", "Rogét Chahayed", "Wheezy"]. */
export function producersOf(p: string): string[] {
  if (isUnknown(p)) return [];
  return p
    .replace(/\([^)]*\)/g, "")
    .replace(/Tyler, the Creator/gi, "Tyler the Creator")
    .split(/,| & | and | x |\//i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !isUnknown(s) && !/^(others?|various|uncredited)$/i.test(s))
    .map((s) => (/^Tyler the Creator$/i.test(s) ? "Tyler, the Creator" : s));
}

/** Producers with the most songs here, for the "By producer" shelf. */
export const TOP_PRODUCERS: [string, number][] = (() => {
  const counts = new Map<string, { name: string; n: number }>();
  for (const s of ALL_SONGS) {
    for (const name of producersOf(s.producer)) {
      const k = name.toLowerCase();
      const c = counts.get(k) ?? { name, n: 0 };
      c.n++;
      counts.set(k, c);
    }
  }
  return [...counts.values()].filter((c) => c.n >= 3).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((c): [string, number] => [c.name, c.n]);
})();

export function madeBy(s: Song, producer: string): boolean {
  const k = producer.toLowerCase();
  return producersOf(s.producer).some((p) => p.toLowerCase() === k);
}

const BY_KEY = new Map(ALL_SONGS.map((s) => [s.key, s]));

/** The page link for a song, by its title and artist as the rows spell them. */
export function songHref(song: string, artist: string): string {
  const s = BY_KEY.get(songKey(song, artist));
  return s ? `/presets/${s.slug}` : "/presets";
}
