import type { SupabaseClient } from "@supabase/supabase-js";
import { LICENSES, itemHref, itemPageSchema, parseItemParam, type ItemPage, type ItemType } from "@stash/contracts";
import { PROFILE_COLUMNS, toProfile, type ProfileRow } from "../profile.ts";
import { loadRows, readTags } from "./load-rows.ts";
import { ITEM_COLUMNS, SAMPLE_COLUMNS, toKitSample, type ItemDbRow, type SampleDbRow } from "./rows.ts";

export type ItemPageResult = { kind: "page"; page: ItemPage } | { kind: "redirect"; href: string } | { kind: "not_found" };

/** How many of the owner's other items the page shows (itemPageSchema caps it at 10). */
const MORE_FROM_OWNER = 10;

/**
 * The item page's data (route /[type]/[slug]-[publicId]). Reads only as the caller: anon or the
 * signed-in viewer, through row-level security. Only published items have a page.
 *
 * The public id decides which item it is. When the type or slug in the URL is not the item's own
 * (a renamed item, a hand-typed URL), the result is a redirect to the canonical href.
 * `similar` is empty until ticket 204.
 */
export async function getItemPage(supabase: SupabaseClient, viewerId: string | null, type: string, param: string): Promise<ItemPageResult> {
  const parsed = parseItemParam(param);
  if (!parsed) return { kind: "not_found" };

  const found = await supabase
    .from("items")
    .select(ITEM_COLUMNS)
    .eq("public_id", parsed.publicId)
    .eq("status", "published")
    .maybeSingle<ItemDbRow>();
  if (found.error) throw found.error;
  const item = found.data;
  if (!item) return { kind: "not_found" };

  const href = itemHref({ type: item.type as ItemType, slug: item.slug, publicId: item.public_id });
  if (item.type !== type || item.slug !== parsed.slug) return { kind: "redirect", href };

  const [rows, owner, allTags, samples, follows, more] = await Promise.all([
    loadRows(supabase, [item], viewerId),
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", item.owner_id).single<ProfileRow>(),
    readTags(supabase, item.tag_names),
    item.type === "kit"
      ? supabase.from("kit_samples").select(SAMPLE_COLUMNS).eq("item_id", item.id).order("position")
      : Promise.resolve({ data: null, error: null }),
    viewerId && viewerId !== item.owner_id
      ? supabase.from("follows").select("follower_id").eq("follower_id", viewerId).eq("followee_id", item.owner_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("items")
      .select(ITEM_COLUMNS)
      .eq("owner_id", item.owner_id)
      .eq("status", "published")
      .neq("id", item.id)
      .order("published_at", { ascending: false })
      .limit(MORE_FROM_OWNER),
  ]);
  for (const r of [owner, samples, follows, more]) if (r.error) throw r.error;

  const row = rows[0];
  // A published item always has its derived files; one that does not is a pipeline bug.
  if (!row) throw new Error(`item ${item.id} is published but cannot be played`);
  const profile = toProfile(owner.data!);

  return {
    kind: "page",
    page: itemPageSchema.parse({
      item: {
        ...row,
        description: item.description,
        genre: item.genre,
        splitPercent: item.split_percent,
        licenseVersion: LICENSES[row.license].version,
        allTags,
      },
      owner: {
        id: profile.id,
        handle: profile.handle,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        followersCount: profile.followersCount,
        viewerFollows: Boolean(follows.data),
      },
      ...(samples.data && { samples: (samples.data as SampleDbRow[]).map(toKitSample) }),
      moreFromOwner: await loadRows(supabase, (more.data ?? []) as unknown as ItemDbRow[], viewerId),
      similar: [],
    }),
  };
}
