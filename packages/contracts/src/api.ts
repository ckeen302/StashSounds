import { z } from "zod";
import {
  itemStatusSchema,
  itemTypeSchema,
  licenseKindSchema,
  notificationKindSchema,
  reportReasonSchema,
  sortSchema,
} from "./enums.ts";
import {
  bpmSchema,
  cursorSchema,
  descriptionSchema,
  handleSchema,
  isoDateTimeSchema,
  musicalKeySchema,
  publicIdSchema,
  splitPercentSchema,
  tagNameSchema,
  titleSchema,
  uuidSchema,
} from "./common.ts";
import { itemRowSchema, itemSchema } from "./item.ts";
import { bioSchema, displayNameSchema, ownerSummarySchema, profileLinkSchema, profileSchema } from "./profile.ts";
import { limits } from "./limits.ts";

/**
 * Every server action and route handler: input and output. Each action's output is wrapped in
 * Result<T> (see errors.ts) by the single action wrapper in apps/web/src/server.
 */

// ---------------------------------------------------------------------------
// Uploads

export const createUploadSlotInput = z.object({
  type: itemTypeSchema,
  /** "original" for the main file; "demo" for a preset's demo audio, attached to an existing draft. */
  role: z.enum(["original", "demo"]).default("original"),
  /** Required when role is "demo": the preset draft the demo belongs to. */
  itemId: uuidSchema.optional(),
  fileName: z.string().min(1).max(255),
  bytes: z.int().positive(),
  mime: z.string().max(100),
});
export const presignedUploadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single"), url: z.url(), headers: z.record(z.string(), z.string()) }),
  z.object({
    kind: z.literal("multipart"),
    uploadId: z.string(),
    partBytes: z.int().positive(),
    parts: z.array(z.object({ partNumber: z.int().positive(), url: z.url() })).min(1),
  }),
]);
export const createUploadSlotOutput = z.object({
  itemId: uuidSchema,
  fileId: uuidSchema,
  upload: presignedUploadSchema,
  expiresAt: isoDateTimeSchema,
});

export const completeUploadInput = z.object({
  itemId: uuidSchema,
  fileId: uuidSchema,
  /** Multipart only: the ETag of each uploaded part. */
  parts: z.array(z.object({ partNumber: z.int().positive(), etag: z.string() })).optional(),
});
export const completeUploadOutput = z.object({
  itemId: uuidSchema,
  status: z.literal("processing"),
  jobId: uuidSchema,
});

// ---------------------------------------------------------------------------
// Item lifecycle

export const updateItemInput = z
  .object({
    itemId: uuidSchema,
    title: titleSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    genre: z.string().trim().min(1).max(40).nullable().optional(),
    tags: z.array(tagNameSchema).max(limits.tags.perItem).optional(),
    referenceTags: z.array(tagNameSchema).max(limits.tags.perItem).optional(),
    license: licenseKindSchema.optional(),
    splitPercent: splitPercentSchema.nullable().optional(),
    bpm: bpmSchema.nullable().optional(),
    key: musicalKeySchema.nullable().optional(),
  })
  .refine((v) => (v.tags?.length ?? 0) + (v.referenceTags?.length ?? 0) <= limits.tags.perItem, {
    message: `Up to ${limits.tags.perItem} tags in total.`,
    path: ["tags"],
  });
export const updateItemOutput = itemSchema;

export const publishItemInput = z.object({
  itemId: uuidSchema,
  /** The uploader warranty: they made it or hold the rights, and it has no samples from paid packs or released records. */
  rightsConfirmed: z.literal(true),
  /** Presets only: wavetables are the uploader's own or factory content. */
  wavetablesConfirmed: z.boolean().optional(),
});
export const publishItemOutput = z.object({ itemId: uuidSchema, publishedAt: isoDateTimeSchema, href: z.string() });

export const itemIdInput = z.object({ itemId: uuidSchema });
export const unpublishItemInput = itemIdInput;
export const unpublishItemOutput = z.object({ itemId: uuidSchema, status: z.literal("ready") });
export const deleteItemInput = itemIdInput;
export const deleteItemOutput = z.object({ itemId: uuidSchema, status: z.literal("removed") });

// ---------------------------------------------------------------------------
// Downloads

export const requestDownloadInput = z.object({
  itemId: uuidSchema,
  /** Kits only: one sample instead of the whole ZIP. */
  sampleId: uuidSchema.optional(),
});
export const requestDownloadOutput = z.object({
  downloadId: uuidSchema,
  url: z.url(),
  expiresAt: isoDateTimeSchema,
  fileName: z.string(),
  license: licenseKindSchema,
  licenseVersion: z.string(),
});

export const downloadRecordSchema = z.object({
  id: uuidSchema,
  itemId: uuidSchema.nullable(),
  itemTitle: z.string(),
  ownerHandle: z.string(),
  license: licenseKindSchema,
  licenseVersion: z.string(),
  splitPercent: splitPercentSchema.nullable(),
  createdAt: isoDateTimeSchema,
  /** Null when the item has since been removed; the record stays. */
  item: itemRowSchema.nullable(),
});
export type DownloadRecord = z.infer<typeof downloadRecordSchema>;

// ---------------------------------------------------------------------------
// Social

export const toggleLikeInput = itemIdInput;
export const toggleLikeOutput = z.object({ liked: z.boolean(), likesCount: z.int().nonnegative() });

export const toggleFollowInput = z.object({ profileId: uuidSchema });
export const toggleFollowOutput = z.object({ following: z.boolean(), followersCount: z.int().nonnegative() });

export const updateProfileInput = z.object({
  displayName: displayNameSchema.optional(),
  bio: bioSchema.nullable().optional(),
  links: z.array(profileLinkSchema).max(8).optional(),
  /** Path in the previews bucket returned by an avatar upload slot. */
  avatarPath: z.string().max(200).nullable().optional(),
});
export const updateProfileOutput = profileSchema;

export const claimHandleInput = z.object({ handle: handleSchema, displayName: displayNameSchema.optional() });
export const claimHandleOutput = profileSchema;

// ---------------------------------------------------------------------------
// Safety

export const reportItemInput = z.object({
  itemId: uuidSchema,
  reason: reportReasonSchema,
  detail: z.string().trim().max(1000).optional(),
});
export const reportItemOutput = z.object({ reportId: uuidSchema });

export const submitTakedownInput = z.object({
  /** The Stash URL or public id of the work being reported. */
  itemRef: z.union([publicIdSchema, z.url()]),
  claimantName: z.string().trim().min(2).max(120),
  claimantEmail: z.email(),
  workDescription: z.string().trim().min(10).max(2000),
  /** The good-faith and accuracy statements, as typed or agreed by the claimant. */
  statement: z.string().trim().min(10).max(4000),
  signature: z.string().trim().min(2).max(120),
  challengeToken: z.string().min(1),
});
export const submitTakedownOutput = z.object({ noticeId: uuidSchema });

export const markNotificationsReadInput = z.object({ ids: z.array(uuidSchema).max(200).optional() });
export const markNotificationsReadOutput = z.object({ updated: z.int().nonnegative() });

export const adminReviewInput = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["approve_item", "remove_item", "restore_item"]), itemId: uuidSchema, reason: z.string().min(1).max(500) }),
  z.object({ action: z.enum(["uphold_report", "dismiss_report"]), reportId: uuidSchema, reason: z.string().min(1).max(500) }),
  z.object({ action: z.enum(["suspend_user", "restore_user"]), userId: uuidSchema, reason: z.string().min(1).max(500) }),
  z.object({
    action: z.enum(["uphold_takedown", "reject_takedown", "restore_after_counter"]),
    noticeId: uuidSchema,
    reason: z.string().min(1).max(500),
  }),
]);
export const adminReviewOutput = z.object({ auditId: uuidSchema });

// ---------------------------------------------------------------------------
// Read routes

const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === "string" ? (v === "" ? [] : v.split(",")) : v), z.array(item));

/** GET /api/items. All filters also live in the page URL, with the same names. */
export const listItemsQuery = z
  .object({
    type: itemTypeSchema.optional(),
    q: z.string().trim().max(100).optional(),
    bpmMin: z.coerce.number().min(limits.bpm.min).max(limits.bpm.max).optional(),
    bpmMax: z.coerce.number().min(limits.bpm.min).max(limits.bpm.max).optional(),
    /** Written like "F#m" or "Eb"; parsed with parseKey. */
    key: z.string().max(12).optional(),
    /** Include compatible keys (relative and neighbours) when filtering by key. */
    compatible: z.coerce.boolean().optional(),
    genre: z.string().max(40).optional(),
    tags: csv(tagNameSchema).optional(),
    style: tagNameSchema.optional(),
    owner: handleSchema.optional(),
    sort: sortSchema.default("new"),
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(limits.lists.pageSize).default(limits.lists.pageSize),
  })
  .refine((v) => v.bpmMin === undefined || v.bpmMax === undefined || v.bpmMin <= v.bpmMax, {
    message: "The lowest BPM must be below the highest.",
    path: ["bpmMin"],
  });
export type ListItemsQuery = z.infer<typeof listItemsQuery>;

export const listItemsResponse = z.object({
  items: z.array(itemRowSchema),
  nextCursor: cursorSchema.nullable(),
  /** Search only: how many results each type has, for the grouped tabs. */
  counts: z.partialRecord(itemTypeSchema, z.int().nonnegative()).optional(),
});
export type ListItemsResponse = z.infer<typeof listItemsResponse>;

export const feedQuery = z.object({ cursor: cursorSchema.optional() });
export const feedResponse = z.object({
  items: z.array(itemRowSchema),
  nextCursor: cursorSchema.nullable(),
  /** Which part of the feed this page came from. Signed-in feeds move from following to trending. */
  source: z.enum(["following", "trending"]),
});
export type FeedResponse = z.infer<typeof feedResponse>;

export const similarItemsResponse = z.object({ items: z.array(itemRowSchema).max(10) });

export const notificationSchema = z.object({
  id: uuidSchema,
  kind: notificationKindSchema,
  actor: ownerSummarySchema.nullable(),
  item: z.object({ id: uuidSchema, title: z.string(), href: z.string() }).nullable(),
  /** Batched: ten likes on one item within an hour are one notification with count 10. */
  count: z.int().positive(),
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;
export const notificationsResponse = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.int().nonnegative(),
  nextCursor: cursorSchema.nullable(),
});

export const libraryQuery = z.object({
  tab: z.enum(["likes", "downloads", "uploads"]),
  status: itemStatusSchema.optional(),
  cursor: cursorSchema.optional(),
});

export const healthResponse = z.object({ ok: z.literal(true), version: z.string() });
