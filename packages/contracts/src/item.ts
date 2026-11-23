import { z } from "zod";
import { itemStatusSchema, itemTypeSchema, jobStatusSchema, licenseKindSchema, tagKindSchema } from "./enums.ts";
import {
  bpmSchema,
  descriptionSchema,
  isoDateTimeSchema,
  musicalKeySchema,
  peaksSchema,
  publicIdSchema,
  slugSchema,
  splitPercentSchema,
  tagNameSchema,
  titleSchema,
  uuidSchema,
} from "./common.ts";
import { kitDetailsSchema, loopDetailsSchema, midiDetailsSchema, oneshotDetailsSchema, presetDetailsSchema } from "./details.ts";
import { kitSampleSchema } from "./files.ts";
import { limits } from "./limits.ts";
import { playableSchema } from "./playable.ts";
import { ownerSummarySchema } from "./profile.ts";

export const tagSchema = z.object({ name: tagNameSchema, kind: tagKindSchema });
export type Tag = z.infer<typeof tagSchema>;

const itemCommon = {
  id: uuidSchema,
  publicId: publicIdSchema,
  ownerId: uuidSchema,
  status: itemStatusSchema,
  title: titleSchema,
  slug: slugSchema,
  description: descriptionSchema.nullable(),
  license: licenseKindSchema,
  splitPercent: splitPercentSchema.nullable(),
  genre: z.string().max(40).nullable(),
  bpm: bpmSchema.nullable(),
  key: musicalKeySchema.nullable(),
  durationMs: z.int().nonnegative().nullable(),
  tags: z.array(tagSchema),
  likesCount: z.int().nonnegative(),
  downloadsCount: z.int().nonnegative(),
  flaggedReason: z.string().nullable(),
  publishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

/**
 * An item as stored. details is null until the worker has processed the original, so it is
 * nullable here and required once status is ready or later (enforced by itemSchema's refinement).
 */
export const itemSchema = z
  .discriminatedUnion("type", [
    z.object({ ...itemCommon, type: z.literal("loop"), details: loopDetailsSchema.nullable() }),
    z.object({ ...itemCommon, type: z.literal("oneshot"), details: oneshotDetailsSchema.nullable() }),
    z.object({ ...itemCommon, type: z.literal("kit"), details: kitDetailsSchema.nullable() }),
    z.object({ ...itemCommon, type: z.literal("midi"), details: midiDetailsSchema.nullable() }),
    z.object({ ...itemCommon, type: z.literal("preset"), details: presetDetailsSchema.nullable() }),
  ])
  .refine((i) => i.details !== null || i.status === "draft" || i.status === "processing", {
    message: "details are required once an item has been processed",
    path: ["details"],
  })
  .refine((i) => (i.license === "split_on_placement") === (i.splitPercent !== null), {
    message: "split percent is set exactly when the license is split on placement",
    path: ["splitPercent"],
  });
export type Item = z.infer<typeof itemSchema>;

/**
 * Everything one result row needs to draw and play, so a row never triggers a second request
 * before sound. Build spec: Conventions.
 */
export const itemRowSchema = z.object({
  id: uuidSchema,
  publicId: publicIdSchema,
  type: itemTypeSchema,
  title: titleSchema,
  slug: slugSchema,
  /** Canonical path, e.g. /loop/dark-keys-k3j9x0a2bq */
  href: z.string().regex(/^\/(?![/\\])/, "Must be a same-site path"),
  owner: ownerSummarySchema.pick({ handle: true, displayName: true, avatarUrl: true }),
  license: licenseKindSchema,
  bpm: bpmSchema.nullable(),
  key: musicalKeySchema.nullable(),
  durationMs: z.int().nonnegative().nullable(),
  /** Bars for loops and MIDI, seconds for one-shots, sample count for kits, null for presets. */
  length: z.object({ unit: z.enum(["bars", "samples", "seconds"]), value: z.number().nonnegative() }).nullable(),
  tags: z.array(tagNameSchema).max(limits.tags.perItem),
  /** 800 peak bytes for audio types; null for MIDI (the row draws the piano roll strip from notes). */
  peaks: peaksSchema.nullable(),
  playable: playableSchema,
  likesCount: z.int().nonnegative(),
  downloadsCount: z.int().nonnegative(),
  publishedAt: isoDateTimeSchema,
  /** Present when the request had a signed-in viewer. */
  viewer: z.object({ liked: z.boolean() }).optional(),
});
export type ItemRow = z.infer<typeof itemRowSchema>;

/** The data the item page renders on the server. */
export const itemPageSchema = z.object({
  item: itemRowSchema.extend({
    description: descriptionSchema.nullable(),
    genre: z.string().nullable(),
    splitPercent: splitPercentSchema.nullable(),
    licenseVersion: z.string(),
    allTags: z.array(tagSchema),
  }),
  owner: ownerSummarySchema.extend({ followersCount: z.int().nonnegative(), viewerFollows: z.boolean() }),
  /** Kits only: every sample, including those beyond the sixteen pads. */
  samples: z.array(kitSampleSchema).optional(),
  moreFromOwner: z.array(itemRowSchema).max(10),
  similar: z.array(itemRowSchema).max(10),
});
export type ItemPage = z.infer<typeof itemPageSchema>;

/** An owner's own view of a draft or processing item on the upload screen and library. */
export const ownItemSchema = z.object({
  item: itemSchema,
  job: z
    .object({
      status: jobStatusSchema,
      attempts: z.int().nonnegative(),
      /** Plain-language reason, safe to show the uploader. */
      error: z.string().nullable(),
    })
    .nullable(),
  /** Detected fields the uploader should double-check because the sources disagreed. */
  checkFields: z.array(z.enum(["bpm", "key", "rootNote"])),
});
export type OwnItem = z.infer<typeof ownItemSchema>;
