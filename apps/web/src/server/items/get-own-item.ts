import { WORKER_REASON_TEXT, err, itemIdInput, ok, ownItemSchema, workerReasonSchema, type JobStatus } from "@stash/contracts";
import { defineAction } from "../action.ts";
import { readTags } from "./load-rows.ts";
import { ITEM_COLUMNS, checkFields, toItem, type ItemDbRow } from "./rows.ts";

type JobDbRow = { status: JobStatus; attempts: number; error: string | null };

/**
 * getOwnItem: an owner's view of one of their items in any state but removed, for the upload
 * screen and the library. Read with the owner's own client, filtered to their own rows, so another
 * user's item is not_found even for an admin. Includes the latest processing job and the detected
 * fields to double-check.
 */
export const getOwnItem = defineAction({
  name: "getOwnItem",
  auth: "member",
  input: itemIdInput,
  output: ownItemSchema,
  handler: async (input, ctx) => {
    const found = await ctx.supabase
      .from("items")
      .select(ITEM_COLUMNS)
      .eq("id", input.itemId)
      .eq("owner_id", ctx.session.user.id)
      .maybeSingle<ItemDbRow>();
    if (found.error) throw found.error;
    const row = found.data;
    if (!row || row.status === "removed") return err("not_found", "Item not found.");

    const [tags, job] = await Promise.all([
      readTags(ctx.supabase, row.tag_names),
      ctx.supabase
        .from("processing_jobs")
        .select("status, attempts, error")
        .eq("item_id", row.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<JobDbRow>(),
    ]);
    if (job.error) throw job.error;

    const item = toItem(row, tags);
    return ok({
      item,
      job: job.data ? { status: job.data.status, attempts: job.data.attempts, error: reasonText(job.data.error) } : null,
      checkFields: checkFields(item),
    });
  },
});

/**
 * The job's error in plain language. The worker stores a reason code (contracts workerReasonSchema);
 * anything else is never shown raw to the uploader.
 */
export function reasonText(error: string | null): string | null {
  if (error === null) return null;
  const reason = workerReasonSchema.safeParse(error);
  return reason.success ? WORKER_REASON_TEXT[reason.data] : WORKER_REASON_TEXT.internal;
}
