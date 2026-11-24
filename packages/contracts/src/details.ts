import { z } from "zod";
import { kitCategorySchema, midiKindSchema, oneshotCategorySchema, presetCategorySchema, presetSynthSchema } from "./enums.ts";
import { midiPitchSchema } from "./common.ts";

/**
 * The per-type shape of items.details. The worker writes it; the database stores it as jsonb;
 * these schemas validate it on both sides (the worker validates against the generated JSON Schema).
 */

export const bpmSourceSchema = z.enum(["filename", "duration", "onset", "midi_file", "assumed", "uploader"]);
export const keySourceSchema = z.enum(["filename", "chroma", "midi_notes", "uploader"]);
export const pitchSourceSchema = z.enum(["filename", "pitch_tracking", "uploader"]);

/** What detection found and how sure it is. Low confidence is shown as "check this", never as a failure. */
export const detectionSchema = z.object({
  bpmSource: bpmSourceSchema.nullable(),
  /** True when the independent BPM sources agreed. */
  bpmAgreed: z.boolean(),
  /** Tempos that fit the length as a whole number of 4/4 bars, best first. */
  bpmCandidates: z.array(z.number()).max(8),
  keySource: keySourceSchema.nullable(),
  /** Margin of the best key over the runner-up, 0 to 1. */
  keyConfidence: z.number().min(0).max(1).nullable(),
});

const audioStatsSchema = z.object({
  sampleRate: z.int().positive(),
  channels: z.int().min(1).max(8),
  /** Integrated loudness of the original. */
  loudnessLufs: z.number().nullable(),
  truePeakDb: z.number().nullable(),
});

export const loopDetailsSchema = audioStatsSchema.extend({
  /** Exact loop length in samples at sampleRate. The player loops on this, not on the preview's length. */
  loopSamples: z.int().positive(),
  bars: z.int().positive().nullable(),
  detection: detectionSchema,
});

export const oneshotDetailsSchema = audioStatsSchema.extend({
  category: oneshotCategorySchema,
  rootNote: midiPitchSchema.nullable(),
  rootNoteSource: pitchSourceSchema.nullable(),
});

export const kitDetailsSchema = z.object({
  sampleCount: z.int().min(1),
  categoryCounts: z.partialRecord(kitCategorySchema, z.int().min(0)),
  /** Files in the ZIP that were not audio and were ignored. */
  ignoredCount: z.int().min(0),
  hasCover: z.boolean(),
});

export const midiDetailsSchema = z.object({
  kind: midiKindSchema,
  bars: z.int().positive(),
  noteCount: z.int().positive(),
  pitchMin: midiPitchSchema,
  pitchMax: midiPitchSchema,
  timeSignature: z.tuple([z.int().positive(), z.int().positive()]),
  /** True when the file had no tempo event and 120 BPM was assumed. */
  tempoAssumed: z.boolean(),
  detection: detectionSchema,
});

export const presetDetailsSchema = z.object({
  synth: presetSynthSchema,
  /** Display name, e.g. "Vital" or "Serum", or the uploader's name for an unknown synth. */
  synthName: z.string().min(1).max(40),
  synthVersion: z.string().max(40).nullable(),
  category: presetCategorySchema,
  /** True when the worker rendered sampled notes (Vital only). */
  rendered: z.boolean(),
  sampledNoteCount: z.int().min(0),
  demoDurationMs: z.int().positive(),
});

export const detailsSchemas = {
  loop: loopDetailsSchema,
  oneshot: oneshotDetailsSchema,
  kit: kitDetailsSchema,
  midi: midiDetailsSchema,
  preset: presetDetailsSchema,
} as const;

export type LoopDetails = z.infer<typeof loopDetailsSchema>;
export type OneshotDetails = z.infer<typeof oneshotDetailsSchema>;
export type KitDetails = z.infer<typeof kitDetailsSchema>;
export type MidiDetails = z.infer<typeof midiDetailsSchema>;
export type PresetDetails = z.infer<typeof presetDetailsSchema>;
export type Detection = z.infer<typeof detectionSchema>;
