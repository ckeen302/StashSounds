import type { CSSProperties } from "react";
import COVERS from "./covers.json";
import SHEETS from "./cover-sheets.json";
import { PRESETS } from "./data";

/**
 * The album cover beside a song. Real art comes from covers.json (the file is published next to the
 * page, since the page can't load images from other sites). Until a song has one, nothing is shown.
 */

type CoverRow = {
  file: string;
  album: string;
  source: { label: string; url: string };
};
const ROWS = COVERS as Record<string, CoverRow>;

export function coverKey(song: string, artist: string): string {
  return `${song}|${artist}`.toLowerCase();
}

// A song merged from rows that spell it differently still finds its cover: by title and lead artist.
const loose = (song: string, artist: string) => {
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${flat(song)}|${flat(artist.split(/ feat\.? | ft\.? | x |,| & | \(/i)[0] ?? artist)}`;
};
const LOOSE = new Map<string, CoverRow>();
for (const [k, row] of Object.entries(ROWS)) {
  const [song = "", artist = ""] = k.split("|");
  const lk = loose(song, artist);
  if (!LOOSE.has(lk)) LOOSE.set(lk, row);
}

// Songs on the same album share its cover: one found cover covers every song on that album.
const flatName = (x: string) => x.toLowerCase().replace(/\(.*?\)|deluxe|edition/g, "").replace(/[^a-z0-9]/g, "");
const BY_ALBUM = new Map<string, CoverRow>();
for (const [k, row] of Object.entries(ROWS)) {
  const artist = k.split("|")[1] ?? "";
  const ak = `${flatName(row.album)}|${loose("", artist).split("|")[1]}`;
  if (row.album && !/^single$/i.test(row.album) && !BY_ALBUM.has(ak)) BY_ALBUM.set(ak, row);
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

// Covers are packed onto sprite sheets (scripts/pack-demo-covers.py): each file is a tile on one.
const SHEET = SHEETS as unknown as { grid: number; sheets: string[]; tiles: Record<string, [number, number, number]> };

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
  // No made-up art: a plain record tile holds the space until the real cover is in.
  if (!placeholder) return null;
  return (
    <span aria-hidden="true" className={`${box} st-cover st-cover-empty shrink-0 rounded-control border border-border`}>
      <span className="st-cover-disc" />
    </span>
  );
}
