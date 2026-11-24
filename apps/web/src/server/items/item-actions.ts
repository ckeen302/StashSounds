import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  deleteItemInput,
  deleteItemOutput,
  err,
  isoDateTimeSchema,
  itemHref,
  itemTypeSchema,
  limits,
  ok,
  publishItemInput,
  publishItemOutput,
  unpublishItemInput,
  unpublishItemOutput,
  updateItemInput,
  updateItemOutput,
} from "@stash/contracts";
import { defineAction } from "../action.ts";
import { readTags } from "./load-rows.ts";
import { ITEM_COLUMNS, toOwnItem, type ItemDbRow } from "./rows.ts";

/**
 * Owner edits and lifecycle (build spec: API surface). Every write runs as the owner, so
 * items_update, the column grants and the lifecycle functions decide; nothing uses the service
 * role. Status rules live in the database: publish_item only from ready (a flagged item is a
 * conflict), unpublish_item only from published, nothing for a removed item.
 */

const SPLIT_NEEDED = "Choose the share for split on placement.";
const SPLIT_ONLY = "Only split on placement takes a share.";
const TOO_MANY_TAGS = `Up to ${limits.tags.perItem} tags in total.`;

/** The caller's own item, or null (another user's, missing, or removed). */
async function ownItem(supabase: SupabaseClient, itemId: string, uid: string): Promise<ItemDbRow | null> {
  const { data, error } = await supabase.from("items").select(ITEM_COLUMNS).eq("id", itemId).eq("owner_id", uid).maybeSingle<ItemDbRow>();
  if (error) throw error;
  return data && data.status !== "removed" ? data : null;
}

export const updateItem = defineAction({
  name: "updateItem",
  auth: "member",
  input: updateItemInput,
  output: updateItemOutput,
  handler: async (input, ctx) => {
    const uid = ctx.session.user.id;
    const current = await ownItem(ctx.supabase, input.itemId, uid);
    if (!current) return err("not_found", "Item not found.");

    // Tags first, before any write: set_item_tags replaces both sets, so the set not being edited
    // is sent back unchanged, and the merged total is checked here so the columns are never saved
    // for an edit the tags then refuse (PR #9 B1).
    let tagSets: { tags: string[]; referenceTags: string[] } | null = null;
    if (input.tags !== undefined || input.referenceTags !== undefined) {
      const existing = await readTags(ctx.supabase, current.tag_names);
      const tags = input.tags ?? existing.filter((t) => t.kind !== "reference").map((t) => t.name);
      const referenceTags = input.referenceTags ?? existing.filter((t) => t.kind === "reference").map((t) => t.name);
      if (new Set([...tags, ...referenceTags]).size > limits.tags.perItem) {
        return err("invalid", TOO_MANY_TAGS, { [input.tags !== undefined ? "tags" : "referenceTags"]: TOO_MANY_TAGS });
      }
      tagSets = { tags, referenceTags };
    }

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.genre !== undefined) patch.genre = input.genre;
    if (input.bpm !== undefined) patch.bpm = input.bpm;
    if (input.key !== undefined) {
      patch.key_root = input.key?.root ?? null;
      patch.key_mode = input.key?.mode ?? null;
    }
    if (input.license !== undefined || input.splitPercent !== undefined) {
      const license = input.license ?? current.license;
      const split = input.splitPercent !== undefined ? input.splitPercent : current.split_percent;
      if (license === "split_on_placement") {
        if (split === null) return err("invalid", SPLIT_NEEDED, { splitPercent: SPLIT_NEEDED });
        patch.split_percent = split;
      } else {
        if (input.splitPercent != null) return err("invalid", SPLIT_ONLY, { splitPercent: SPLIT_ONLY });
        // Moving away from split on placement drops the share with it.
        patch.split_percent = null;
      }
      patch.license = license;
    }

    if (Object.keys(patch).length > 0) {
      // Filtered to the owner as well as by policy: a row the policy hides is PGRST116, not_found.
      const { error } = await ctx.supabase.from("items").update(patch).eq("id", input.itemId).eq("owner_id", uid).select("id").single();
      if (error) throw error;
    }

    if (tagSets) {
      const { error } = await ctx.supabase.rpc("set_item_tags", { p_item_id: input.itemId, p_tags: tagSets.tags, p_reference_tags: tagSets.referenceTags });
      if (error) throw error;
    }

    const updated = await ownItem(ctx.supabase, input.itemId, uid);
    if (!updated) return err("not_found", "Item not found.");
    return ok(toOwnItem(updated, await readTags(ctx.supabase, updated.tag_names)));
  },
});

/** What publish_item returns that the output needs. */
const publishedRowSchema = z.object({ id: z.string(), type: itemTypeSchema, slug: z.string(), public_id: z.string(), published_at: isoDateTimeSchema });

export const publishItem = defineAction({
  name: "publishItem",
  auth: "member",
  input: publishItemInput,
  output: publishItemOutput,
  handler: async (input, ctx) => {
    // rightsConfirmed is z.literal(true) in the contract; publish_item checks it again, along with
    // ownership, status ready (a flagged item is a conflict) and a preset's wavetables.
    const { data, error } = await ctx.supabase.rpc("publish_item", {
      p_item_id: input.itemId,
      p_rights_confirmed: input.rightsConfirmed,
      p_wavetables_confirmed: input.wavetablesConfirmed,
    });
    if (error) throw error;
    const row = publishedRowSchema.parse(Array.isArray(data) ? data[0] : data);
    return ok({ itemId: row.id, publishedAt: row.published_at, href: itemHref({ type: row.type, slug: row.slug, publicId: row.public_id }) });
  },
});

export const unpublishItem = defineAction({
  name: "unpublishItem",
  auth: "member",
  input: unpublishItemInput,
  output: unpublishItemOutput,
  handler: async (input, ctx) => {
    const { error } = await ctx.supabase.rpc("unpublish_item", { p_item_id: input.itemId });
    if (error) throw error;
    return ok({ itemId: input.itemId, status: "ready" as const });
  },
});

export const deleteItem = defineAction({
  name: "deleteItem",
  auth: "member",
  input: deleteItemInput,
  output: deleteItemOutput,
  handler: async (input, ctx) => {
    // Owner only. remove_item also lets an admin remove anyone's item; that is moderation
    // (adminReview), so another user's item is not_found here whoever asks.
    if (!(await ownItem(ctx.supabase, input.itemId, ctx.session.user.id))) return err("not_found", "Item not found.");
    const { error } = await ctx.supabase.rpc("remove_item", { p_item_id: input.itemId });
    if (error) throw error;
    return ok({ itemId: input.itemId, status: "removed" as const });
  },
});
