import type { SupabaseClient } from "@supabase/supabase-js";
import { completeUploadInput, completeUploadOutput, err, ok } from "@stash/contracts";
import { defineAction } from "../action.ts";
import { mapError } from "../errors.ts";

type FileRow = { id: string; role: string; path: string; bytes: number; meta: Record<string, unknown> | null; uploaded_at: string | null };

const UPLOAD_AGAIN = "We could not find the uploaded file. Upload it again.";

/**
 * completeUpload (architecture: upload pipeline step 3). In order:
 * 1. The item and file are read with the caller's own client and filtered to their own rows, so
 *    another user's item is not_found before storage or the queue is touched.
 * 2. A multipart upload is completed with the caller's part ETags.
 * 3. The object is HEADed, and its measured size goes to enqueue_processing (service role only),
 *    which refuses a size other than the declared one and a suspended account, moves the draft to
 *    processing and queues the worker's job. On either refusal the object is deleted, so nothing
 *    stays in storage that the worker will not process (CLAUDE.md rule 10).
 * A preset needs both its original and its demo; until both are confirmed it waits in draft.
 */
export const completeUpload = defineAction({
  name: "completeUpload",
  auth: "member",
  input: completeUploadInput,
  output: completeUploadOutput,
  handler: async (input, ctx) => {
    const uid = ctx.session.user.id;

    const item = await ctx.supabase
      .from("items")
      .select("id, type")
      .eq("id", input.itemId)
      .eq("owner_id", uid)
      .maybeSingle<{ id: string; type: string }>();
    if (item.error) throw item.error;
    if (!item.data) return err("not_found", "Item not found.");

    const file = await ctx.supabase
      .from("item_files")
      .select("id, role, path, bytes, meta, uploaded_at")
      .eq("id", input.fileId)
      .eq("item_id", input.itemId)
      .eq("bucket", "originals")
      .maybeSingle<FileRow>();
    if (file.error) throw file.error;
    if (!file.data) return err("not_found", "File not found.");
    const { path } = file.data;

    const storage = ctx.storage();
    const uploadId = typeof file.data.meta?.uploadId === "string" ? file.data.meta.uploadId : null;
    if (uploadId) {
      if (!input.parts?.length) return err("invalid", "List the uploaded parts.", { parts: "List the uploaded parts." });
      // "gone" on a repeat call: the upload was already completed (the HEAD below decides).
      await storage.completeMultipart(path, uploadId, input.parts);
    }

    const stored = await storage.head(path);
    if (!stored) return err("not_found", UPLOAD_AGAIN);

    const { data: jobId, error } = await ctx.service().rpc("enqueue_processing", {
      p_user_id: uid,
      p_item_id: input.itemId,
      p_file_id: input.fileId,
      p_measured_bytes: stored.bytes,
    });
    if (error) {
      // Refused for good (wrong size, suspended account): the worker will never process this
      // object, so it must not stay in storage. A conflict means the worker already has it.
      const code = mapError(error)?.code;
      if (code === "invalid" || code === "forbidden") await storage.remove(path);
      throw error;
    }
    if (jobId) return ok({ itemId: input.itemId, status: "processing" as const, jobId: jobId as string });

    return ok({ itemId: input.itemId, status: "draft" as const, jobId: null, waitingFor: await waitingFor(ctx.supabase, input.itemId, file.data) });
  },
});

/** Which file a preset still waits for once this one is confirmed. */
async function waitingFor(supabase: SupabaseClient, itemId: string, file: FileRow): Promise<"original" | "demo"> {
  const { data, error } = await supabase.from("item_files").select("id, role, uploaded_at").eq("item_id", itemId).eq("bucket", "originals");
  if (error) throw error;
  const others = ((data ?? []) as Array<Pick<FileRow, "id" | "role" | "uploaded_at">>).filter((f) => f.id !== file.id);
  const pending = others.find((f) => f.uploaded_at === null);
  if (pending) return pending.role === "demo" ? "demo" : "original";
  // Nothing else is pending, so the other file has no row yet: a demo slot not requested.
  return file.role === "demo" ? "original" : "demo";
}
