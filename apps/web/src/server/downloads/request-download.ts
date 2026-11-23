import { z } from "zod";
import { err, isoDateTimeSchema, licenseKindSchema, limits, ok, requestDownloadInput, requestDownloadOutput, uuidSchema } from "@stash/contracts";
import { defineAction } from "../action.ts";
import { contentDisposition, downloadFileName } from "./file-name.ts";

/** The downloads row record_download returns. */
const downloadRowSchema = z.object({
  id: uuidSchema,
  item_id: uuidSchema,
  item_title: z.string(),
  license: licenseKindSchema,
  license_version: z.string(),
  created_at: isoDateTimeSchema,
});

const NOT_UPLOADED = "This file has not finished uploading.";

/**
 * requestDownload (architecture: step 7 Download). In order:
 * 1. record_download, as the caller, decides everything: signed in and not suspended, the item
 *    published (or the caller's own), a kit sample belonging to it, and the daily download limit
 *    (rate_limit_user('download')). It writes the license record with the license version. Nothing
 *    below runs unless it succeeds.
 * 2. The original's path is read with the service role, for exactly the item (and sample) just
 *    approved: policies hide originals from everyone but the owner, and kit_samples.original_path
 *    is never selectable through the API, because originals are only ever signed by the server.
 * 3. A GET is signed for limits.urls.downloadTtlSeconds that always downloads as an attachment
 *    named from the title, with the Content-Type from the database (the file row, or for a kit
 *    sample the database's own mime_for_ext of its stored extension), never the uploader's.
 */
export const requestDownload = defineAction({
  name: "requestDownload",
  auth: "member",
  input: requestDownloadInput,
  output: requestDownloadOutput,
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase.rpc("record_download", { p_item_id: input.itemId, p_kit_sample_id: input.sampleId ?? null });
    if (error) throw error;
    const record = downloadRowSchema.parse(Array.isArray(data) ? data[0] : data);

    const service = ctx.service();
    let path: string;
    let contentType: string;
    let fileName: string;
    if (input.sampleId) {
      const sample = await service
        .from("kit_samples")
        .select("name, original_path")
        .eq("id", input.sampleId)
        .eq("item_id", input.itemId)
        .single<{ name: string; original_path: string }>();
      if (sample.error) throw sample.error;
      path = sample.data.original_path;
      fileName = downloadFileName(record.item_title, path, sample.data.name);
      const ext = /\.([A-Za-z0-9]{1,10})$/.exec(path)?.[1]?.toLowerCase() ?? "";
      const mime = await service.rpc("mime_for_ext", { p_ext: ext });
      if (mime.error) throw mime.error;
      contentType = z.string().min(1).parse(mime.data);
    } else {
      const file = await service
        .from("item_files")
        .select("path, mime, uploaded_at")
        .eq("item_id", input.itemId)
        .eq("role", "original")
        .eq("bucket", "originals")
        .single<{ path: string; mime: string; uploaded_at: string | null }>();
      if (file.error) throw file.error;
      // Only the owner's own unfinished draft can get here; there is nothing to sign yet.
      if (!file.data.uploaded_at) return err("not_found", NOT_UPLOADED);
      path = file.data.path;
      contentType = file.data.mime;
      fileName = downloadFileName(record.item_title, path);
    }

    const ttl = limits.urls.downloadTtlSeconds;
    const url = await ctx.storage().presignGet(path, { contentDisposition: contentDisposition(fileName), contentType });
    return ok({
      downloadId: record.id,
      url,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      fileName,
      license: record.license,
      licenseVersion: record.license_version,
    });
  },
});
