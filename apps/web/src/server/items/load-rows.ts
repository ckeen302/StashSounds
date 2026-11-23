import type { SupabaseClient } from "@supabase/supabase-js";
import { tagSchema, type ItemRow, type Tag } from "@stash/contracts";
import { PROFILE_COLUMNS, toProfile, type ProfileRow } from "../profile.ts";
import { FILE_COLUMNS, KIT_PADS, SAMPLE_COLUMNS, toItemRow, type FileDbRow, type ItemDbRow, type SampleDbRow } from "./rows.ts";

/**
 * Result rows for a list of items, in the given order. Always called with the caller's own client
 * (anon or the signed-in user), so row-level security decides what is read: only previews-bucket
 * files, kit samples without their original path, public profiles and the viewer's own likes.
 * One query per table for the whole list, never one per row.
 *
 * An item that cannot be built into a row (not published, or missing a derived file) is logged
 * and left out, so one broken item never breaks a list.
 */
export async function loadRows(supabase: SupabaseClient, items: ItemDbRow[], viewerId: string | null): Promise<ItemRow[]> {
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const ownerIds = [...new Set(items.map((i) => i.owner_id))];
  const kitIds = items.filter((i) => i.type === "kit").map((i) => i.id);

  const [owners, files, samples, likes] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).in("id", ownerIds),
    supabase.from("item_files").select(FILE_COLUMNS).in("item_id", ids).eq("bucket", "previews"),
    kitIds.length
      ? supabase.from("kit_samples").select(SAMPLE_COLUMNS).in("item_id", kitIds).lt("position", KIT_PADS)
      : Promise.resolve({ data: [], error: null }),
    viewerId
      ? supabase.from("likes").select("item_id").eq("user_id", viewerId).in("item_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [owners, files, samples, likes]) if (r.error) throw r.error;

  const ownerById = new Map(((owners.data ?? []) as ProfileRow[]).map((p) => [p.id, toProfile(p)]));
  const liked = new Set(((likes.data ?? []) as Array<{ item_id: string }>).map((l) => l.item_id));
  const filesOf = groupBy((files.data ?? []) as FileDbRow[]);
  const samplesOf = groupBy((samples.data ?? []) as SampleDbRow[]);

  const rows: ItemRow[] = [];
  for (const item of items) {
    const owner = ownerById.get(item.owner_id);
    const row = owner
      ? toItemRow({
          row: item,
          owner: { handle: owner.handle, displayName: owner.displayName, avatarUrl: owner.avatarUrl },
          files: filesOf.get(item.id) ?? [],
          samples: samplesOf.get(item.id) ?? [],
          ...(viewerId && { viewerLiked: liked.has(item.id) }),
        })
      : null;
    if (row) rows.push(row);
    else console.warn(`item ${item.id}: left out of a list (not published, no owner, or missing a derived file)`);
  }
  return rows;
}

function groupBy<T extends { item_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.item_id);
    if (list) list.push(r);
    else out.set(r.item_id, [r]);
  }
  return out;
}

/** An item's tags with their kinds, by name (tags are readable by everyone). Sorted by name. */
export async function readTags(supabase: SupabaseClient, names: string[]): Promise<Tag[]> {
  if (names.length === 0) return [];
  const { data, error } = await supabase.from("tags").select("name, kind").in("name", names);
  if (error) throw error;
  return ((data ?? []) as unknown[])
    .flatMap((t) => {
      const r = tagSchema.safeParse(t);
      return r.success ? [r.data] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
