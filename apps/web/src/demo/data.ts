import { itemPageSchema, itemRowSchema, LICENSES, type ItemPage, type ItemRow, type LicenseKind } from "@stash/contracts";
import generated from "./generated/loops.json" with { type: "json" };
import more from "./generated/more-loops.json" with { type: "json" };

/**
 * The demo's catalog: the five generated loop fixtures (scripts/build-demo.mjs made their previews
 * and peaks), with demo copy, as the rows and item pages the real API returns. Parsed with the
 * contract schemas at start-up, so the demo cannot drift from the real shapes. Everything here is
 * demo data: the producers and their numbers are made up.
 */

export type Producer = { id: string; handle: string; displayName: string; followers: number };

export const producers = {
  kilo: { id: "00000000-0000-4000-8000-0000000000a1", handle: "kilo_beats", displayName: "Kilo Beats", followers: 1204 },
  nova: { id: "00000000-0000-4000-8000-0000000000a2", handle: "nova", displayName: "Nova", followers: 8730 },
  marcus: { id: "00000000-0000-4000-8000-0000000000a3", handle: "mvrcus", displayName: "Marcus Vale", followers: 96 },
} satisfies Record<string, Producer>;

export const extra = {
  juno: { id: "00000000-0000-4000-8000-0000000000a4", handle: "junovega", displayName: "Juno Vega", followers: 15400 },
  dre: { id: "00000000-0000-4000-8000-0000000000a5", handle: "drestatic", displayName: "Dre Static", followers: 4210 },
} satisfies Record<string, Producer>;

const ALL = { ...producers, ...extra };

type Copy = {
  n: number;
  title: string;
  slug: string;
  owner: Producer;
  tags: string[];
  genre: string;
  reference: string;
  description: string;
  license: LicenseKind;
  likes: number;
  downloads: number;
  publishedAt: string;
};

const copy: Record<string, Copy> = {
  "dusty-soul-90-dmin": {
    n: 1, title: "Dusty soul chops", slug: "dusty-soul-chops", owner: producers.kilo,
    tags: ["soul", "boom bap", "dusty"], genre: "Boom bap", reference: "j dilla",
    description: "Chopped soul keys through a dusty tape chain. Leave room for a kick on the one; it sits under a rapper without fighting the vocal.",
    license: "royalty_free", likes: 312, downloads: 1480, publishedAt: "2026-11-21T19:30:00Z",
  },
  "midnight-keys-140bpm-am": {
    n: 2, title: "Midnight keys", slug: "midnight-keys", owner: producers.nova,
    tags: ["keys", "dark"], genre: "Trap", reference: "metro boomin",
    description: "Dark electric piano voicings, sidechained lightly. Made for late sessions.",
    license: "royalty_free", likes: 1046, downloads: 4210, publishedAt: "2026-11-22T02:10:00Z",
  },
  "trap-bells-150-fsm": {
    n: 3, title: "Trap bells in F sharp", slug: "trap-bells-in-f-sharp", owner: producers.nova,
    tags: ["bells", "trap"], genre: "Trap", reference: "southside",
    description: "Bell melody in F sharp minor with a little pitch drift on the tails.",
    license: "credit_required", likes: 488, downloads: 1702, publishedAt: "2026-11-19T16:45:00Z",
  },
  "drill-lead-142": {
    n: 4, title: "Sliding drill lead", slug: "sliding-drill-lead", owner: producers.marcus,
    tags: ["drill", "lead"], genre: "Drill", reference: "ax",
    description: "Sliding lead with a short glide. Pairs with an 808 pattern on the off-beats.",
    license: "royalty_free", likes: 57, downloads: 203, publishedAt: "2026-11-23T11:05:00Z",
  },
  "rnb-pad-72bpm-ebmaj": {
    n: 5, title: "Late night R&B pad", slug: "late-night-rnb-pad", owner: producers.kilo,
    tags: ["rnb", "pad", "warm"], genre: "R&B", reference: "brent faiyaz",
    description: "Warm pad that opens up slowly. Good under vocals.",
    license: "royalty_free", likes: 221, downloads: 690, publishedAt: "2026-11-18T22:00:00Z",
  },
};

type Entry = Omit<(typeof generated.loops)[number], "fixture" | "key"> & { key: { root: number; mode: string } | null };

/** The loops rendered from the demo's own MIDI patterns (scripts/gen-demo-loops.py), numbered after the five fixtures. */
const moreCopy: Record<string, Copy> = Object.fromEntries(
  more.loops.map((l, i) => {
    const c = l.copy;
    return [l.slug, { ...c, n: 6 + i, owner: ALL[c.owner as keyof typeof ALL], license: c.license as LicenseKind, slug: l.slug }];
  }),
);

function rowFor(e: Entry, c: Copy, base: string): ItemRow {
  const publicId = `demoloop${String(c.n).padStart(2, "0")}`;
  const id = `00000000-0000-4000-8000-${String(c.n).padStart(12, "0")}`;
  return itemRowSchema.parse({
    id,
    publicId,
    type: "loop",
    title: c.title,
    slug: c.slug,
    href: `/loop/${c.slug}-${publicId}`,
    owner: { handle: c.owner.handle, displayName: c.owner.displayName, avatarUrl: null },
    license: c.license,
    bpm: e.bpm,
    key: e.key,
    durationMs: e.durationMs,
    length: { unit: "bars", value: e.bars },
    tags: c.tags,
    peaks: e.peaks,
    playable: {
      kind: "loop",
      id,
      previewUrl: new URL(e.preview.path, base).href,
      loopSamples: e.loopSamples,
      sampleRate: e.sampleRate,
      bpm: e.bpm,
    },
    likesCount: c.likes,
    downloadsCount: c.downloads,
    publishedAt: c.publishedAt,
    viewer: { liked: false },
  });
}

export type Catalog = {
  rows: ItemRow[];
  page: (publicId: string) => ItemPage | null;
  hrefOf: (publicId: string) => string | null;
};

/** Builds the catalog with preview URLs relative to the page (`base`, normally document.baseURI). */
export function buildCatalog(base: string): Catalog {
  const all: Entry[] = [...generated.loops, ...more.loops];
  const entries = all.map((e) => {
    const c = copy[e.slug] ?? moreCopy[e.slug];
    if (!c) throw new Error(`no demo copy for ${e.slug}`);
    return { e, c, row: rowFor(e, c, base) };
  });
  // Newest first, the way a feed reads.
  entries.sort((a, b) => b.c.publishedAt.localeCompare(a.c.publishedAt));
  const rows = entries.map((x) => x.row);
  const pages = new Map<string, ItemPage>();
  for (const { c, row } of entries) {
    const mine = entries.filter((x) => x.c.owner.id === c.owner.id && x.row.id !== row.id).map((x) => x.row);
    // Same genre first, then the rest; a page holds at most 10 of each list.
    const others = entries
      .filter((x) => x.c.owner.id !== c.owner.id)
      .sort((a, b) => Number(b.c.genre === c.genre) - Number(a.c.genre === c.genre))
      .map((x) => x.row);
    pages.set(
      row.publicId,
      itemPageSchema.parse({
        item: {
          ...row,
          description: `${c.description} Demo data: this producer and these numbers are made up.`,
          genre: c.genre,
          splitPercent: null,
          licenseVersion: LICENSES[row.license].version,
          allTags: [...row.tags.map((name) => ({ name, kind: "tag" as const })), { name: c.reference, kind: "reference" as const }],
        },
        owner: { id: c.owner.id, handle: c.owner.handle, displayName: c.owner.displayName, avatarUrl: null, followersCount: c.owner.followers, viewerFollows: false },
        moreFromOwner: mine.length > 0 ? mine.slice(0, 10) : others.slice(0, 3),
        similar: others.slice(0, 10),
      }),
    );
  }
  return {
    rows,
    page: (publicId) => pages.get(publicId) ?? null,
    hrefOf: (publicId) => pages.get(publicId)?.item.href ?? null,
  };
}
