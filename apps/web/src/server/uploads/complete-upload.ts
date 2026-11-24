import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completeUploadInput, completeUploadOutput, err, ok } from "@stash/contracts";
import { defineAction } from "../action.ts";
import { mapError } from "../errors.ts";
import { stagingKey, type OriginalsStorage } from "../storage/originals.ts";

type FileRow = {
  id: string;
  role: string;
  path: string;
  bytes: number;
  mime: string;
  meta: Record<string, unknown> | null;
  uploaded_at: string | null;
};

const UPLOAD_AGAIN = "We could not find the uploaded file. Upload it again.";
const PARTS_AGAIN = "Some parts did not upload. Upload it again.";
const IN_PROGRESS = "This file is already being completed. Try again in a moment.";

/**
 * completeUpload (architecture: upload pipeline step 3). In order:
 * 1. The item and file are read with the caller's own client and filtered to their own rows, so
 *    another user's item is not_found before storage or the queue is touched. An item that is no
 *    longer a draft is a conflict here, before storage: its original is the worker's now.
 * 2. The file is claimed (claim_file_completion, service role, decision 0016) before any storage
 *    call. A file already confirmed, or one another call is completing right now, is never copied
 *    onto: a confirmed file returns the item's current state, a live claim is a conflict.
 * 3. A multipart upload is completed (on the staging key) with the caller's part ETags.
 * 4. Just before copying, file_claim_held checks this call still holds the claim (a call that
 *    stalled past the claim's lifetime may have been overtaken). The staged object is copied,
 *    server side, to the row's own path with the row's MIME type (never the uploader's
 *    Content-Type), mark_file_copied records meta.copiedAt under the claim, and the staged object
 *    is deleted. Presigned URLs only ever name the staging key, so a PUT after this point cannot
 *    change what the worker checks. With no staged object, the final object is used only if this
 *    row recorded its own copy (an earlier call that stopped before the queue).
 * 5. The copy is HEADed, and its measured size goes to enqueue_processing with the claim's token
 *    (service role only), which confirms the file and clears the claim only while that token
 *    holds it (decision 0016, claims are fenced). On a refused size or a suspended account the
 *    objects are deleted, so nothing stays in storage that the worker will not process (rule 10).
 *    Any exit before the file is confirmed releases the claim, so the owner can retry at once.
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
      .select("id, type, status")
      .eq("id", input.itemId)
      .eq("owner_id", uid)
      .maybeSingle<{ id: string; type: string; status: string }>();
    if (item.error) throw item.error;
    if (!item.data) return err("not_found", "Item not found.");
    if (item.data.status !== "draft") return err("conflict", "This item is already processing.");

    const file = await readFile(ctx.supabase, input.itemId, input.fileId);
    if (!file) return err("not_found", "File not found.");
    if (file.uploaded_at) return ok(await draftState(ctx.supabase, input.itemId, file));

    const service = ctx.service();
    const token = randomUUID();
    const claim = await service.rpc("claim_file_completion", { p_user_id: uid, p_item_id: input.itemId, p_file_id: input.fileId, p_token: token });
    if (claim.error) throw claim.error;
    if (claim.data !== true) {
      // Confirmed meanwhile (return where the item stands), or another call holds the claim.
      const now = await readFile(ctx.supabase, input.itemId, input.fileId);
      if (now?.uploaded_at) return ok(await draftState(ctx.supabase, input.itemId, now));
      return err("conflict", IN_PROGRESS);
    }

    const { path, mime } = file;
    const staged = stagingKey(uid, input.itemId, input.fileId);
    let confirmed = false;
    try {
      const storage = ctx.storage();
      const uploadId = typeof file.meta?.uploadId === "string" ? file.meta.uploadId : null;
      if (uploadId) {
        if (!input.parts?.length) return err("invalid", "List the uploaded parts.", { parts: "List the uploaded parts." });
        // "gone" on a repeat call: the upload was already completed (the HEAD below decides).
        const completed = await storage.completeMultipart(staged, uploadId, input.parts);
        if (completed === "invalid_parts") return err("invalid", PARTS_AGAIN, { parts: PARTS_AGAIN });
      }

      if (await storage.head(staged)) {
        // A conflict here or below deletes nothing: another call holds the file now.
        if (!(await claimHeld(service, input.fileId, token))) return err("conflict", IN_PROGRESS);
        await storage.copy(staged, path, mime);
        if (!(await markCopied(service, input.fileId, token))) return err("conflict", IN_PROGRESS);
        await quietly(() => storage.remove(staged), "staged upload");
      } else if (typeof file.meta?.copiedAt !== "string") {
        // Nothing staged and no copy of our own: whatever is at the final key is not this upload.
        return err("invalid", UPLOAD_AGAIN);
      }
      const stored = await storage.head(path);
      if (!stored) return err("invalid", UPLOAD_AGAIN);

      const { data: jobId, error } = await service.rpc("enqueue_processing", {
        p_user_id: uid,
        p_item_id: input.itemId,
        p_file_id: input.fileId,
        p_measured_bytes: stored.bytes,
        p_token: token,
      });
      if (error) {
        // Refused for good (wrong size, suspended account): the worker will never process this
        // object, so it must not stay in storage. The delete is safe because enqueue_processing
        // checks the claim first, before size or suspension (foundations 0da7500): invalid or
        // forbidden reaches only the call that still holds the claim, so the copy is this call's
        // own. A conflict (the item left draft, or the claim was taken over) deletes nothing: the
        // worker or another call may be using it.
        const code = mapError(error)?.code;
        if (code === "invalid" || code === "forbidden") await removeAll(storage, [path, staged]);
        throw error;
      }
      confirmed = true;
      if (jobId) return ok({ itemId: input.itemId, status: "processing" as const, jobId: jobId as string });
      return ok(await draftState(ctx.supabase, input.itemId, file));
    } finally {
      if (!confirmed) {
        await quietly(async () => {
          const { error } = await service.rpc("release_file_completion", { p_file_id: input.fileId, p_token: token });
          if (error) throw error;
        }, "completion claim");
      }
    }
  },
});

async function readFile(supabase: SupabaseClient, itemId: string, fileId: string): Promise<FileRow | null> {
  const { data, error } = await supabase
    .from("item_files")
    .select("id, role, path, bytes, mime, meta, uploaded_at")
    .eq("id", fileId)
    .eq("item_id", itemId)
    .eq("bucket", "originals")
    .maybeSingle<FileRow>();
  if (error) throw error;
  return data;
}

/** True while this call's token still holds the claim on the unconfirmed file. */
async function claimHeld(service: SupabaseClient, fileId: string, token: string): Promise<boolean> {
  const { data, error } = await service.rpc("file_claim_held", { p_file_id: fileId, p_token: token });
  if (error) throw error;
  return data === true;
}

/** Records meta.copiedAt in one statement under the claim; false if the claim is gone. */
async function markCopied(service: SupabaseClient, fileId: string, token: string): Promise<boolean> {
  const { data, error } = await service.rpc("mark_file_copied", { p_file_id: fileId, p_token: token });
  if (error) throw error;
  return data === true;
}

/** Cleanup after a refusal: a storage failure is logged, so the database's answer is what the caller gets. */
async function removeAll(storage: OriginalsStorage, keys: string[]) {
  for (const key of keys) await quietly(() => storage.remove(key), "refused upload");
}

async function quietly(fn: () => Promise<void>, what: string) {
  try {
    await fn();
  } catch (e) {
    console.error(`completeUpload: could not clean up the ${what}:`, (e as Error).message);
  }
}

/** A draft that waits for its other file (a preset's original or demo). */
async function draftState(supabase: SupabaseClient, itemId: string, file: FileRow) {
  return { itemId, status: "draft" as const, jobId: null, waitingFor: await waitingFor(supabase, itemId, file) };
}

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
