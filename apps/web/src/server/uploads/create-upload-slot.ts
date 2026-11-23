import type { SupabaseClient } from "@supabase/supabase-js";
import { createUploadSlotInput, createUploadSlotOutput, err, limits, ok } from "@stash/contracts";
import { defineAction } from "../action.ts";

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
 * Then storage: one presigned PUT for the file's path, or, above limits.multipart.thresholdBytes,
 * a multipart upload whose id is kept on the file row (meta.uploadId) for completeUpload. Nothing
 * is processed until completeUpload queues the worker.
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
    let path: string;
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
      const row = firstRow<{ file_id: string; path: string }>(data);
      itemId = input.itemId;
      fileId = row.file_id;
      path = row.path;
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
      const row = firstRow<{ item_id: string; file_id: string; path: string }>(data);
      itemId = row.item_id;
      fileId = row.file_id;
      path = row.path;
    }

    const expiresAt = new Date(Date.now() + limits.urls.uploadTtlSeconds * 1000).toISOString();
    const storage = ctx.storage();

    if (input.bytes <= limits.multipart.thresholdBytes) {
      const { url, headers } = await storage.presignPut(path, input.bytes);
      return ok({ itemId, fileId, upload: { kind: "single" as const, url, headers }, expiresAt });
    }

    const m = await storage.startMultipart(path, input.bytes);
    try {
      await rememberUploadId(ctx.service(), fileId, m.uploadId);
    } catch (e) {
      await storage.abortMultipart(path, m.uploadId).catch(() => {});
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

function firstRow<T>(data: unknown): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("upload function returned no row");
  return row as T;
}
