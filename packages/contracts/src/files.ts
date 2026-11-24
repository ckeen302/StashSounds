import { z } from "zod";
import { bucketSchema, fileRoleSchema, kitCategorySchema } from "./enums.ts";
import { isoDateTimeSchema, midiPitchSchema, uuidSchema } from "./common.ts";

export const itemFileSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema,
  role: fileRoleSchema,
  bucket: bucketSchema,
  path: z.string().min(1),
  bytes: z.int().nonnegative(),
  mime: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  /** Role-specific: a sampled_note carries { pitch }, a preview carries { bitrateKbps }. */
  meta: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
});
export type ItemFile = z.infer<typeof itemFileSchema>;

/** One sample inside a kit, as the browser sees it. The original's path is never exposed. */
export const kitSampleSchema = z.object({
  id: uuidSchema,
  position: z.int().min(0),
  name: z.string().min(1),
  category: kitCategorySchema,
  durationMs: z.int().positive(),
  rootNote: midiPitchSchema.nullable(),
  previewUrl: z.url(),
});
export type KitSample = z.infer<typeof kitSampleSchema>;

/**
 * The notes file the worker writes for a MIDI item and the piano roll draws.
 * Each note is [startBeat, lengthBeats, pitch, velocity], sorted by start.
 */
export const midiNoteSchema = z.tuple([z.number().nonnegative(), z.number().positive(), midiPitchSchema, z.int().min(1).max(127)]);
export const midiNotesFileSchema = z.object({
  version: z.literal(1),
  bpm: z.number().positive(),
  timeSignature: z.tuple([z.int().positive(), z.int().positive()]),
  bars: z.int().positive(),
  pitchMin: midiPitchSchema,
  pitchMax: midiPitchSchema,
  /** True when the notes sit on the percussion channel. */
  drums: z.boolean(),
  notes: z.array(midiNoteSchema).min(1),
});
export type MidiNotesFile = z.infer<typeof midiNotesFileSchema>;
