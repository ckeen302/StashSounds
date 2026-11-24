"use server";

/**
 * Server actions for uploads (ticket 134 calls them). Flow:
 * 1. createUploadSlot(createUploadSlotInput) → { itemId, fileId, upload, expiresAt }.
 *    upload.kind "single": PUT the file to upload.url (no extra headers needed).
 *    upload.kind "multipart": PUT each partBytes slice to its part URL and keep each response's ETag.
 * 2. completeUpload({ itemId, fileId, parts? }) → processing with a jobId, or, for a preset whose
 *    other file is still to come, { status: "draft", jobId: null, waitingFor }.
 * A preset: createUploadSlot the original, then { role: "demo", itemId } for its demo; complete both.
 */
import type { Result, completeUploadOutput, createUploadSlotOutput } from "@stash/contracts";
import type { z } from "zod";
import { requestDeps } from "../request-deps.ts";
import { completeUpload as completeAction } from "./complete-upload.ts";
import { createUploadSlot as slotAction } from "./create-upload-slot.ts";

export async function createUploadSlot(input: unknown): Promise<Result<z.output<typeof createUploadSlotOutput>>> {
  return slotAction.run(input, requestDeps);
}

export async function completeUpload(input: unknown): Promise<Result<z.output<typeof completeUploadOutput>>> {
  return completeAction.run(input, requestDeps);
}
