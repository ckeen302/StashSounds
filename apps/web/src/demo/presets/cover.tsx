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

export function coverFor(song: string, artist: string): CoverRow | null {
  return ROWS[coverKey(song, artist)] ?? LOOSE.get(loose(song, artist)) ?? null;
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
        style={{ backgroundImage: `url("${row.file}")` }}
        className={`${box} st-cover shrink-0 rounded-control border border-border bg-raised bg-cover bg-center shadow-lg`}
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
