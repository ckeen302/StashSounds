import { z } from "zod";
import { completeUploadOutput, uuidSchema } from "@stash/contracts";

/**
 * completeUpload's output while a preset waits for its other file. contracts' completeUploadOutput
 * only allows { status: "processing", jobId }, but enqueue_processing queues nothing until a
 * preset has both its original and its demo. Proposed in docs/requests/102-complete-upload-waiting.md;
 * delete this file and import from @stash/contracts once the lead adds it.
 */
export const completeUploadWaitingOutput = z.object({
  itemId: uuidSchema,
  status: z.literal("draft"),
  jobId: z.null(),
  /** The file still to be uploaded and confirmed before processing starts. */
  waitingFor: z.enum(["original", "demo"]),
});

export const completeUploadResultOutput = z.union([completeUploadOutput, completeUploadWaitingOutput]);
