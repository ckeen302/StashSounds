import { itemPageSchema, itemRowSchema, LICENSES, type ItemPage, type ItemRow, type LicenseKind } from "@stash/contracts";
import generated from "./generated/loops.json" with { type: "json" };
import more from "./generated/more-loops.json" with { type: "json" };
import creator from "./creator/loops.json" with { type: "json" };

/**
 * The demo's catalog: the five generated loop fixtures (scripts/build-demo.mjs made their previews
 * and peaks), with demo copy, as the rows and item pages the real API returns. Parsed with the
 * contract schemas at start-up, so the demo cannot drift from the real shapes. Everything here was made
 * for the demo and is posted by one account, with no invented numbers.
 */

export type Producer = { id: string; handle: string; displayName: string; followers: number };

/**
 * Every demo sound is posted by one honest account: the loops, patterns and kits were made for this
 * demo, so no invented producers and no invented counts. Likes and downloads start at zero and count
 * what this browser does.
 */
export const HOUSE: Producer = { id: "00000000-0000-4000-8000-0000000000a1", handle: "stash", displayName: "Stash", followers: 0 };

export const producers = { kilo: HOUSE, nova: HOUSE, marcus: HOUSE } satisfies Record<string, Producer>;
export const extra = { juno: HOUSE, dre: HOUSE } satisfies Record<string, Producer>;

/** Producers who posted their own loops to the demo (creator/loops.json, from scripts/add-creator-loop.py). */
export const CREATORS: Producer[] = [...new Map(creator.loops.map((l, i) => [l.copy.owner.handle, { id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, handle: l.copy.owner.handle, displayName: l.copy.owner.displayName, followers: 0 }])).values()];

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

/** Their loops, numbered after the generated ones. */
const creatorCopy: Record<string, Copy> = Object.fromEntries(
  creator.loops.map((l, i) => {
    const c = l.copy;
    const owner = CREATORS.find((p) => p.handle === c.owner.handle)!;
    return [l.slug, { ...c, n: 6 + more.loops.length + i, owner, license: c.license as LicenseKind, slug: l.slug, reference: c.genre.toLowerCase(), likes: 0, downloads: 0 }];
  }),
);

/** The size of each loop's download, by item id: the tag line shows it, the way a loop library does. */
export const LOOP_BYTES = new Map<string, number>();
/** A producer's own upload, by item id: Download gives this file, not the preview. */
export const ORIGINALS = new Map<string, { url: string; name: string }>();

function rowFor(e: Entry, c: Copy, base: string): ItemRow {
  const publicId = `demoloop${String(c.n).padStart(2, "0")}`;
  const id = `00000000-0000-4000-8000-${String(c.n).padStart(12, "0")}`;
  const original = (e as { original?: { path: string; name: string; bytes: number } }).original;
  LOOP_BYTES.set(id, original?.bytes ?? e.preview.bytes);
  if (original) ORIGINALS.set(id, { url: new URL(original.path, base).href, name: original.name });
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
    likesCount: 0,
    downloadsCount: 0,
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
  const all: Entry[] = [...generated.loops, ...more.loops, ...creator.loops];
  const entries = all.map((e) => {
    const c = copy[e.slug] ?? moreCopy[e.slug] ?? creatorCopy[e.slug];
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
          description: c.description,
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
