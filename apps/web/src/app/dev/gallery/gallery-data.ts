import { itemRowSchema, type ItemRow } from "@stash/contracts";
import { drillLeadPeaks, dustySoulPeaks, midnightKeysPeaks, rnbPadPeaks, trapBellsPeaks } from "./fixture-peaks";

/**
 * Gallery content: the five synthetic loops in fixtures/generated/loops, with their real peaks,
 * lengths and tempos, as the rows the API would return. Parsed with the contract so the gallery
 * breaks if the row shape moves.
 */
function row(r: {
  n: number;
  title: string;
  slug: string;
  handle: string;
  displayName: string;
  bpm: number;
  key: ItemRow["key"];
  durationMs: number;
  bars: number;
  tags: string[];
  peaks: string;
  liked?: boolean;
  license?: ItemRow["license"];
}): ItemRow {
  const publicId = `k3j9x0a2b${r.n}`;
  return itemRowSchema.parse({
    id: `00000000-0000-4000-8000-00000000000${r.n}`,
    publicId,
    type: "loop",
    title: r.title,
    slug: r.slug,
    href: `/loop/${r.slug}-${publicId}`,
    owner: { handle: r.handle, displayName: r.displayName, avatarUrl: null },
    license: r.license ?? "royalty_free",
    bpm: r.bpm,
    key: r.key,
    durationMs: r.durationMs,
    length: { unit: "bars", value: r.bars },
    tags: r.tags,
    peaks: r.peaks,
    playable: {
      kind: "loop",
      id: `00000000-0000-4000-8000-00000000000${r.n}`,
      previewUrl: `https://media.stash.local/previews/${publicId}.ogg`,
      loopSamples: Math.round((r.durationMs / 1000) * 44100),
      sampleRate: 44100,
      bpm: r.bpm,
    },
    likesCount: 120 + r.n * 37,
    downloadsCount: 400 + r.n * 91,
    publishedAt: "2026-11-20T18:00:00Z",
    viewer: { liked: r.liked ?? false },
  });
}

export const rows = {
  dustySoul: row({
    n: 1, title: "Dusty soul chops", slug: "dusty-soul-chops", handle: "kilo_beats", displayName: "Kilo Beats",
    bpm: 90, key: { root: 2, mode: "minor" }, durationMs: 5333, bars: 2, tags: ["soul", "boom bap", "dusty"], peaks: dustySoulPeaks,
  }),
  midnightKeys: row({
    n: 2, title: "Midnight keys", slug: "midnight-keys", handle: "nova", displayName: "Nova",
    bpm: 140, key: { root: 9, mode: "minor" }, durationMs: 6857, bars: 4, tags: ["keys", "dark"], peaks: midnightKeysPeaks, liked: true,
  }),
  trapBells: row({
    n: 3, title: "Trap bells in F sharp", slug: "trap-bells", handle: "sosa_wav", displayName: "Sosa",
    bpm: 150, key: { root: 6, mode: "minor" }, durationMs: 6400, bars: 4, tags: ["bells", "trap"], peaks: trapBellsPeaks, license: "credit_required",
  }),
  drillLead: row({
    n: 4, title: "Sliding drill lead", slug: "sliding-drill-lead", handle: "mvrcus", displayName: "Marcus Vale",
    bpm: 142, key: { root: 1, mode: "minor" }, durationMs: 3380, bars: 2, tags: ["drill", "lead"], peaks: drillLeadPeaks,
  }),
  rnbPad: row({
    n: 5, title: "Late night R&B pad, a very long title that has to truncate cleanly", slug: "late-night-rnb-pad", handle: "deja_on_keys", displayName: "Deja",
    bpm: 72, key: { root: 3, mode: "major" }, durationMs: 6667, bars: 2, tags: ["rnb", "pad", "warm"], peaks: rnbPadPeaks,
  }),
};
