import { z } from "zod";
import { kitCategorySchema, soundIdSchema } from "./enums.ts";
import { midiPitchSchema } from "./common.ts";

/**
 * Everything the audio engine needs to make sound, with no further lookup.
 * packages/audio takes exactly this type. Build spec: Audio engine interface.
 */
export const playableSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("loop"),
    id: z.string(),
    previewUrl: z.url(),
    loopSamples: z.int().positive(),
    sampleRate: z.int().positive(),
    bpm: z.number().positive().optional(),
    keyRoot: z.int().min(0).max(11).optional(),
  }),
  z.object({
    kind: z.literal("oneshot"),
    id: z.string(),
    previewUrl: z.url(),
    rootNote: midiPitchSchema.optional(),
  }),
  z.object({
    kind: z.literal("kit"),
    id: z.string(),
    pads: z
      .array(z.object({ index: z.int().min(0), name: z.string(), category: kitCategorySchema, previewUrl: z.url() }))
      .max(16),
  }),
  z.object({
    kind: z.literal("midi"),
    id: z.string(),
    notesUrl: z.url(),
    bpm: z.number().positive(),
    sound: soundIdSchema,
  }),
  z.object({
    kind: z.literal("preset"),
    id: z.string(),
    demoUrl: z.url(),
    sampledNotes: z.array(z.object({ pitch: midiPitchSchema, url: z.url() })).optional(),
  }),
]);
export type Playable = z.infer<typeof playableSchema>;
