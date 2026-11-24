import COVERS from "./covers.json";

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

export function coverFor(song: string, artist: string): CoverRow | null {
  return ROWS[coverKey(song, artist)] ?? null;
}

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
  // No stand-in art: until the real cover is in, the entry shows none.
  return null;
}
