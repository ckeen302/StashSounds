import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createUploadSlotInput, createUploadSlotOutput, err, limits, ok, uuidSchema } from "@stash/contracts";
import { defineAction } from "../action.ts";
import { stagingKey } from "../storage/originals.ts";

/** What the upload functions return. Parsed so a schema change fails loudly before anything is signed. */
const draftRowSchema = z.object({ item_id: uuidSchema, file_id: uuidSchema, path: z.string().min(1) });
const demoRowSchema = draftRowSchema.omit({ item_id: true });

/** "C:\loops\Night Drive.flac" → { title: "Night Drive", ext: "flac" }. */
export function splitFileName(fileName: string): { title: string; ext: string } {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return { title: base.trim(), ext: "" };
  return { title: base.slice(0, dot).trim(), ext: base.slice(dot + 1).toLowerCase() };
}

/**
 * createUploadSlot (build spec: API surface; architecture: upload pipeline step 1).
 *
 * The database decides: create_upload_draft (an original, a new draft) and add_demo_file (a
 * preset's demo) run as the user and check verified email, suspension, type, size, uploads per
 * day and quota. They take the extension, never the browser's MIME type (decision 0008): `mime`
 * in the input is accepted for the contract and ignored.
 *
 * Then storage: one presigned PUT, or, above limits.multipart.thresholdBytes, a multipart upload
 * whose id is kept on the file row (meta.uploadId) for completeUpload. Either is signed for the
 * file's staging key (storage/originals.ts stagingKey), never for the row's path: completeUpload
 * copies the staged object there, so a URL that is still valid afterwards cannot change what the
 * worker checked. Nothing is processed until completeUpload queues the worker.
 */
export const createUploadSlot = defineAction({
  name: "createUploadSlot",
  auth: "member",
  input: createUploadSlotInput,
  output: createUploadSlotOutput,
  handler: async (input, ctx) => {
    const { title, ext } = splitFileName(input.fileName);
    if (!ext) return err("invalid", "This file has no extension.", { fileName: "This file has no extension." });

    let itemId: string;
    let fileId: string;
    if (input.role === "demo") {
      if (!input.itemId) return err("invalid", "A demo belongs to a preset draft.", { itemId: "A demo belongs to a preset draft." });
      if (input.type !== "preset") return err("invalid", "Only presets take a demo.", { type: "Only presets take a demo." });
      const { data, error } = await ctx.supabase.rpc("add_demo_file", {
        p_item_id: input.itemId,
        p_bytes: input.bytes,
        p_ext: ext,
        p_file_name: input.fileName,
      });
      if (error) throw error;
      const row = parseRow("add_demo_file", demoRowSchema, data);
      itemId = input.itemId;
      fileId = row.file_id;
    } else {
      if (input.itemId) return err("invalid", "An original starts a new draft.", { itemId: "An original starts a new draft." });
      const { data, error } = await ctx.supabase.rpc("create_upload_draft", {
        p_type: input.type,
        p_title: title,
        p_bytes: input.bytes,
        p_ext: ext,
        p_file_name: input.fileName,
      });
      if (error) throw error;
      const row = parseRow("create_upload_draft", draftRowSchema, data);
      itemId = row.item_id;
      fileId = row.file_id;
    }

    const expiresAt = new Date(Date.now() + limits.urls.uploadTtlSeconds * 1000).toISOString();
    const storage = ctx.storage();
    const key = stagingKey(ctx.session.user.id, itemId, fileId);

    if (input.bytes <= limits.multipart.thresholdBytes) {
      const { url, headers } = await storage.presignPut(key, input.bytes);
      return ok({ itemId, fileId, upload: { kind: "single" as const, url, headers }, expiresAt });
    }

    const m = await storage.startMultipart(key, input.bytes);
    try {
      await rememberUploadId(ctx.service(), fileId, m.uploadId);
    } catch (e) {
      await storage.abortMultipart(key, m.uploadId).catch(() => {});
      throw e;
    }
    return ok({ itemId, fileId, upload: { kind: "multipart" as const, uploadId: m.uploadId, partBytes: m.partBytes, parts: m.parts }, expiresAt });
  },
});

/** Keeps the multipart upload id on the file row (service role: users cannot write item_files). */
async function rememberUploadId(service: SupabaseClient, fileId: string, uploadId: string) {
  const { data, error } = await service.from("item_files").select("meta").eq("id", fileId).single<{ meta: Record<string, unknown> | null }>();
  if (error) throw error;
  const { error: updateError } = await service
    .from("item_files")
    .update({ meta: { ...(data.meta ?? {}), uploadId } })
    .eq("id", fileId);
  if (updateError) throw updateError;
}

function parseRow<T extends z.ZodType>(fn: string, schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(Array.isArray(data) ? data[0] : data);
  if (!r.success) throw new Error(`${fn} returned an unexpected row: ${r.error.message}`);
  return r.data;
}
