import type { CSSProperties } from "react";
import COVERS from "./covers.json";
import SHEETS from "./cover-sheets.json";
import { PRESETS } from "./data";

/**
 * The album cover beside a song. Real art comes from covers.json (the file is published next to the
 * page, since the page can't load images from other sites). Until a song has one, a placeholder tile in the
 * theme's colors shows its initials (or nothing, where the caller asks for no placeholder).
 */

type CoverRow = {
  file: string;
  album: string;
  source: { label: string; url: string };
};
// Covers are packed onto sprite sheets (scripts/pack-demo-covers.py): each file is a tile on one.
const SHEET = SHEETS as unknown as { grid: number; sheets: string[]; tiles: Record<string, [number, number, number]> };

// A row whose file is on no sheet yet (found, not packed) is left out: the page would fetch a file
// that is not published. scripts/qa-nightly.mjs flags such rows.
const ROWS: Record<string, CoverRow> = Object.fromEntries(Object.entries(COVERS as Record<string, CoverRow>).filter(([, r]) => !!SHEET.tiles[r.file]));

export function coverKey(song: string, artist: string): string {
  return `${song}|${artist}`.toLowerCase();
}

// A song merged from rows that spell it differently still finds its cover: by title and lead artist.
const loose = (song: string, artist: string) => {
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${flat(song)}|${flat(artist.split(/ feat\.? | ft\.? | x |,| & | \(/i)[0] ?? artist)}`;
};
const LOOSE = new Map<string, CoverRow>();
// Songs on the same album share its cover: one found cover covers every song on that album.
const flatName = (x: string) => x.toLowerCase().replace(/\(.*?\)|deluxe|edition/g, "").replace(/[^a-z0-9]/g, "");
const BY_ALBUM = new Map<string, CoverRow>();
function index(k: string, row: CoverRow) {
  const [song = "", artist = ""] = k.split("|");
  const lk = loose(song, artist);
  if (!LOOSE.has(lk)) LOOSE.set(lk, row);
  const ak = `${flatName(row.album)}|${loose("", artist).split("|")[1]}`;
  if (row.album && !/^single$/i.test(row.album) && !BY_ALBUM.has(ak)) BY_ALBUM.set(ak, row);
}
for (const [k, row] of Object.entries(ROWS)) index(k, row);

/** A compact cover row (samples/covers.json): file, album, Apple's artist credit, link, and its tile. */
export type LazyCover = { f: string; a: string; by: string; u: string; t?: [number, number, number] };

/**
 * Adds covers that load with a tab of their own (the Samples tab's, which only it needs), so they
 * stay off the first load. Rows already here win.
 */
export function registerCovers(rows: Record<string, LazyCover>) {
  for (const [k, r] of Object.entries(rows)) {
    if (ROWS[k] || !r.t) continue;
    const row: CoverRow = { file: `covers/${r.f}`, album: r.a, source: { label: `Apple Music, ${r.a} by ${r.by}`, url: r.u } };
    ROWS[k] = row;
    index(k, row);
    if (!SHEET.tiles[row.file]) SHEET.tiles[row.file] = r.t;
  }
}

// The album each song is on, from the preset rows that name one.
const ALBUM_OF = new Map<string, string>();
for (const p of PRESETS) if (p.album && !ALBUM_OF.has(loose(p.song, p.artist))) ALBUM_OF.set(loose(p.song, p.artist), p.album);

export function albumOf(song: string, artist: string): string | null {
  return coverFor(song, artist)?.album ?? ALBUM_OF.get(loose(song, artist)) ?? null;
}

export function coverFor(song: string, artist: string): CoverRow | null {
  const direct = ROWS[coverKey(song, artist)] ?? LOOSE.get(loose(song, artist));
  if (direct) return direct;
  const album = ALBUM_OF.get(loose(song, artist));
  if (!album || /^single$/i.test(album)) return null;
  return BY_ALBUM.get(`${flatName(album)}|${loose("", artist).split("|")[1]}`) ?? null;
}


export function tileStyle(file: string): CSSProperties {
  const t = SHEET.tiles[file];
  if (!t) return { backgroundImage: `url("${file}")`, backgroundSize: "cover", backgroundPosition: "center" };
  const [sheet, col, row] = t;
  const step = 100 / (SHEET.grid - 1);
  return { backgroundImage: `url("${SHEET.sheets[sheet]}")`, backgroundSize: `${SHEET.grid * 100}% ${SHEET.grid * 100}%`, backgroundPosition: `${col * step}% ${row * step}%` };
}

export function Cover({
  song,
  artist,
  size = "md",
  placeholder = false,
}: {
  song: string;
  artist: string;
  size?: "sm" | "md" | "lg" | "fill";
  /** Keep the cover's space with a plain record tile while the real art is still being found. */
  placeholder?: boolean;
}) {
  const row = coverFor(song, artist);
  const box =
    size === "fill"
      ? "block aspect-square w-full"
      : size === "sm"
        ? "size-12"
        : size === "lg"
          ? "size-40 tablet:size-56"
          : "size-20 tablet:size-24";
  if (row) {
    // A background image, not <img>: the demo is a static page with no Next image loader behind it.
    return (
      <span
        role="img"
        aria-label={`${row.album} cover`}
        style={tileStyle(row.file)}
        className={`${box} st-cover shrink-0 rounded-control border border-border bg-raised shadow-lg`}
      />
    );
  }
  // No made-up art: a record tile in the theme's colors, with the song's initials, holds the space
  // until the real cover is in. Its faint tint is one of the type tokens, picked by the title.
  if (!placeholder) return null;
  return (
    <span aria-hidden="true" className={`${box} st-cover st-cover-empty st-cover-hue-${hueOf(song)} shrink-0 rounded-control border border-border`}>
      <span className="st-cover-disc" />
      <span className="st-cover-initials">{initials(song)}</span>
    </span>
  );
}

/** Up to two letters from the title's words ("Hotline Bling" is "HB"), skipping a leading "The"/"A". */
export function initials(title: string): string {
  const words = title
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const kept = words.length > 1 && /^(the|a|an)$/i.test(words[0]!) ? words.slice(1) : words;
  return (
    kept
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

function hueOf(title: string): number {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 5;
}
