import { itemHref, itemPageSchema, LICENSES, parseItemParam, type ItemPage, type ItemRow } from "@stash/contracts";
import { rows } from "../dev/gallery/gallery-data";

/**
 * Item pages for the gallery's five fixture loops, so the end-to-end tests can open a real,
 * server-rendered loop page with no database. Read only through the loader, and only when
 * STASH_DEV_PAGES=1 (never in production). Parsed with itemPageSchema, so they cannot drift from
 * the real shape.
 */

/** With STASH_DEV_PAGES=1, this cookie set to "member" makes the fixture viewer signed in. */
export const FIXTURE_VIEWER_COOKIE = "stash-dev-viewer";

export type ItemLookup = { kind: "page"; page: ItemPage } | { kind: "redirect"; href: string } | { kind: "not_found" };

const LIST: ItemRow[] = [rows.dustySoul, rows.midnightKeys, rows.trapBells, rows.drillLead, rows.rnbPad];

const EXTRA: Record<string, { description: string; genre: string; reference: string; followers: number }> = {
  [rows.dustySoul.publicId]: {
    description: "Chopped soul keys through a dusty tape chain. Leave room for a kick on the one; it sits under a rapper without fighting the vocal.",
    genre: "Boom bap",
    reference: "j dilla",
    followers: 1204,
  },
  [rows.midnightKeys.publicId]: { description: "Dark electric piano voicings, sidechained lightly. Made for late sessions.", genre: "Trap", reference: "metro boomin", followers: 8730 },
  [rows.trapBells.publicId]: { description: "Bell melody in F sharp minor with a little pitch drift on the tails.", genre: "Trap", reference: "southside", followers: 452 },
  [rows.drillLead.publicId]: { description: "Sliding lead with a short glide. Pairs with an 808 pattern on the off-beats.", genre: "Drill", reference: "ax", followers: 96 },
  [rows.rnbPad.publicId]: { description: "Warm pad that opens up slowly. Good under vocals.", genre: "R&B", reference: "brent faiyaz", followers: 3310 },
};

const ownerId = (n: number) => `00000000-0000-4000-8000-0000000000a${n}`;

function withViewer(row: ItemRow, signedIn: boolean): ItemRow {
  const { viewer, ...rest } = row;
  return signedIn ? { ...rest, viewer: viewer ?? { liked: false } } : rest;
}

function build(index: number, signedIn: boolean): ItemPage {
  const row = LIST[index]!;
  const extra = EXTRA[row.publicId]!;
  const owner = row.owner;
  // Everything on the page belongs to this owner: the other fixture loops become "more from".
  const moreFromOwner = LIST.filter((r) => r.id !== row.id).map((r) => withViewer({ ...r, owner }, signedIn));
  return itemPageSchema.parse({
    item: {
      ...withViewer(row, signedIn),
      description: extra.description,
      genre: extra.genre,
      splitPercent: null,
      licenseVersion: LICENSES[row.license].version,
      allTags: [...row.tags.map((name) => ({ name, kind: "tag" as const })), { name: extra.reference, kind: "reference" as const }],
    },
    owner: { id: ownerId(index + 1), ...owner, followersCount: extra.followers, viewerFollows: false },
    moreFromOwner,
    similar: [],
  });
}

/** True when the segment names one of the fixture loops. */
export function isFixtureParam(param: string): boolean {
  const parsed = parseItemParam(param);
  return Boolean(parsed && LIST.some((r) => r.publicId === parsed.publicId));
}

/** The fixture page for a route, with the same redirect and not-found rules as the real query. */
export function fixtureItemPage(type: string, param: string, viewer: { signedIn: boolean }): ItemLookup {
  const parsed = parseItemParam(param);
  const index = parsed ? LIST.findIndex((r) => r.publicId === parsed.publicId) : -1;
  if (!parsed || index < 0) return { kind: "not_found" };
  const row = LIST[index]!;
  if (type !== row.type || parsed.slug !== row.slug) return { kind: "redirect", href: itemHref(row) };
  return { kind: "page", page: build(index, viewer.signedIn) };
}
