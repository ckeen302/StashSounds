import { Sprite, type SpriteId } from "../pixel";
import COVERS from "./covers.json";

/**
 * The album cover beside a song. Real art comes from covers.json (the file is published next to the
 * page, since the page can't load images from other sites). Until a song has one, it shows
 * as a pixel item icon on a tile tinted by the song, so a shelf reads as a row of items, not a row of gaps.
 */

type CoverRow = {
  file: string;
  album: string;
  source: { label: string; url: string };
};
const ROWS = COVERS as Record<string, CoverRow>;

const TINTS = [
  ["bg-type-loop/15", "bg-type-loop"],
  ["bg-type-preset/15", "bg-type-preset"],
  ["bg-type-midi/15", "bg-type-midi"],
  ["bg-type-kit/15", "bg-type-kit"],
  ["bg-type-oneshot/15", "bg-type-oneshot"],
  ["bg-accent/15", "bg-accent"],
] as const;

export function coverKey(song: string, artist: string): string {
  return `${song}|${artist}`.toLowerCase();
}

export function coverFor(song: string, artist: string): CoverRow | null {
  return ROWS[coverKey(song, artist)] ?? null;
}

function hash(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function tint(key: string) {
  return TINTS[hash(key) % TINTS.length]!;
}

const ICONS: SpriteId[] = [
  "keys",
  "bell",
  "flute",
  "wave",
  "bass",
  "guitar",
  "pad",
];

export function Cover({
  song,
  artist,
  size = "md",
}: {
  song: string;
  artist: string;
  size?: "sm" | "md" | "lg" | "fill";
}) {
  const row = coverFor(song, artist);
  const box =
    size === "fill"
      ? "aspect-square w-full"
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
        style={{ backgroundImage: `url("${row.file}")` }}
        className={`${box} st-cover shrink-0 rounded-control border border-border bg-raised bg-cover bg-center shadow-lg`}
      />
    );
  }
  const [sleeve] = tint(coverKey(song, artist));
  const icon = ICONS[hash(coverKey(song, artist)) % ICONS.length]!;
  const px =
    size === "sm" ? 30 : size === "lg" ? 96 : size === "fill" ? 64 : 48;
  return (
    <span
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center st-cover overflow-hidden rounded-control border border-border ${sleeve}`}
    >
      <Sprite id={icon} size={px} />
    </span>
  );
}
