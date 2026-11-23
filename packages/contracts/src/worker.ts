import { z } from "zod";
import { bucketSchema, fileRoleSchema, itemTypeSchema, jobKindSchema, kitCategorySchema } from "./enums.ts";
import { midiPitchSchema, musicalKeySchema, uuidSchema } from "./common.ts";
import { detailsSchemas } from "./details.ts";

/** Maps each content type to the job that processes it. */
export const JOB_KIND_FOR_TYPE = {
  loop: "process_loop",
  oneshot: "process_oneshot",
  kit: "process_kit",
  midi: "process_midi",
  preset: "process_preset",
} as const satisfies Record<z.infer<typeof itemTypeSchema>, z.infer<typeof jobKindSchema>>;

/** Reasons the worker may give for a flag or failure. Plain-language text is built from these. */
export const workerReasonSchema = z.enum([
  "duplicate_exact",
  "duplicate_fingerprint",
  "commercial_match",
  "pack_name_blocklist",
  "unsupported_format",
  "corrupt_file",
  "too_long",
  "too_short",
  "too_large",
  "silent",
  "unsafe_archive",
  "no_audio_in_kit",
  "no_notes",
  "too_many_notes",
  "timeout",
  "internal",
]);
export type WorkerReason = z.infer<typeof workerReasonSchema>;

/** Plain language for each reason, shown to the uploader. Design spec: Voice. */
export const WORKER_REASON_TEXT: Record<WorkerReason, string> = {
  duplicate_exact: "This file is already on Stash. If it is yours, tell us and we will review it.",
  duplicate_fingerprint: "This matches something already on Stash. If it is yours, tell us and we will review it.",
  commercial_match: "This matches a released recording. If you hold the rights, tell us and we will review it.",
  pack_name_blocklist: "This looks like a commercial sample pack. If you made it, tell us and we will review it.",
  unsupported_format: "This file type is not supported. Check the formats for this type and upload again.",
  corrupt_file: "This file could not be read. Export it again and upload the new copy.",
  too_long: "This file is longer than the limit for its type. Trim it and upload again.",
  too_short: "This file is shorter than the minimum for its type.",
  too_large: "This file is larger than the limit for its type.",
  silent: "This file is silent. Check the export and upload again.",
  unsafe_archive: "This ZIP could not be opened safely. Remove nested archives and odd folders, then upload again.",
  no_audio_in_kit: "This ZIP has no audio files in it.",
  no_notes: "This MIDI file has no notes in it.",
  too_many_notes: "This MIDI file has more notes than the limit.",
  timeout: "Processing took too long. We will try again shortly.",
  internal: "Something went wrong on our side. We will try again shortly.",
};

/** Payload of processing_jobs rows. The worker reads everything else from the item. */
export const jobPayloadSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  kind: jobKindSchema,
  attempts: z.int().nonnegative(),
});

/** A derived file the worker wrote to storage. */
export const workerFileSchema = z.object({
  role: fileRoleSchema,
  bucket: bucketSchema,
  path: z.string().min(1).max(400),
  bytes: z.int().nonnegative(),
  mime: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export const workerKitSampleSchema = z.object({
  position: z.int().min(0),
  name: z.string().min(1).max(200),
  category: kitCategorySchema,
  durationMs: z.int().positive(),
  rootNote: midiPitchSchema.nullable(),
  originalPath: z.string().min(1),
  previewPath: z.string().min(1),
});

export const workerFingerprintSchema = z.object({
  /** Path of the item_files row this fingerprint belongs to (the original, or a kit sample's original). */
  filePath: z.string().min(1),
  durationMs: z.int().positive(),
  chromaprint: z.array(z.int()).min(1),
});

const resultCommon = {
  bpm: z.number().min(40).max(300).nullable(),
  key: musicalKeySchema.nullable(),
  durationMs: z.int().nonnegative().nullable(),
  files: z.array(workerFileSchema),
  fingerprints: z.array(workerFingerprintSchema).default([]),
  /** Set when screening matched something: the item becomes flagged instead of ready. */
  flag: z.object({ reason: workerReasonSchema, detail: z.string().max(500).optional() }).nullable().default(null),
};

/**
 * What a successful job hands to public.worker_complete, which applies it in one transaction.
 * Validated by the worker before the call (generated/worker-result.schema.json).
 */
export const workerResultSchema = z.discriminatedUnion("type", [
  z.object({ ...resultCommon, type: z.literal("loop"), details: detailsSchemas.loop }),
  z.object({ ...resultCommon, type: z.literal("oneshot"), details: detailsSchemas.oneshot }),
  z.object({ ...resultCommon, type: z.literal("kit"), details: detailsSchemas.kit, kitSamples: z.array(workerKitSampleSchema).min(1) }),
  z.object({ ...resultCommon, type: z.literal("midi"), details: detailsSchemas.midi }),
  z.object({ ...resultCommon, type: z.literal("preset"), details: detailsSchemas.preset }),
]);
export type WorkerResult = z.infer<typeof workerResultSchema>;
