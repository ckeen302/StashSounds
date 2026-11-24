"use server";

/**
 * requestDownload({ itemId, sampleId? }) → { downloadId, url, expiresAt, fileName, license, licenseVersion }.
 * Signed in only. Writes the license record first, then returns a URL to the original that works
 * for limits.urls.downloadTtlSeconds and always saves as `fileName`. For a kit, leave sampleId out
 * for the whole ZIP, or pass one sample's id. Errors: unauthorized, forbidden (suspended),
 * not_found, rate_limited (limits.rateLimits.downloadsPerDay), invalid.
 */
import type { Result, requestDownloadOutput } from "@stash/contracts";
import type { z } from "zod";
import { requestDeps } from "../request-deps.ts";
import { requestDownload as downloadAction } from "./request-download.ts";

export async function requestDownload(input: unknown): Promise<Result<z.output<typeof requestDownloadOutput>>> {
  return downloadAction.run(input, requestDeps);
}
