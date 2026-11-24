import { z } from "zod";
import { accountRoleSchema, profileLinkKindSchema } from "./enums.ts";
import { handleSchema, isoDateTimeSchema, uuidSchema } from "./common.ts";
import { limits } from "./limits.ts";

export const profileLinkSchema = z.object({
  kind: profileLinkKindSchema,
  url: z.url({ protocol: /^https$/ }),
});
export type ProfileLink = z.infer<typeof profileLinkSchema>;

export const displayNameSchema = z.string().trim().min(1).max(limits.text.displayNameMax);
export const bioSchema = z.string().trim().max(limits.text.bioMax);

/** Public identity. Readable by everyone. */
export const profileSchema = z.object({
  id: uuidSchema,
  handle: handleSchema,
  displayName: displayNameSchema,
  bio: bioSchema.nullable(),
  avatarUrl: z.url().nullable(),
  links: z.array(profileLinkSchema).max(8),
  followersCount: z.int().nonnegative(),
  followingCount: z.int().nonnegative(),
  createdAt: isoDateTimeSchema,
});
export type Profile = z.infer<typeof profileSchema>;

/** The small owner block a result row or item page shows. */
export const ownerSummarySchema = profileSchema.pick({ id: true, handle: true, displayName: true, avatarUrl: true });
export type OwnerSummary = z.infer<typeof ownerSummarySchema>;

/** Profile as seen by a signed-in viewer. */
export const profileViewSchema = profileSchema.extend({
  viewerFollows: z.boolean(),
  isViewer: z.boolean(),
  /** Total downloads across the owner's published items. */
  downloadsTotal: z.int().nonnegative(),
});
export type ProfileView = z.infer<typeof profileViewSchema>;

/** Private account state. Only the owner and admins ever see it. */
export const accountSchema = z.object({
  id: uuidSchema,
  role: accountRoleSchema,
  storageBytes: z.int().nonnegative(),
  storageQuotaBytes: z.int().positive(),
  strikes: z.int().nonnegative(),
  suspendedAt: isoDateTimeSchema.nullable(),
  emailVerified: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;

/** Handles nobody may claim. */
export const RESERVED_HANDLES = new Set([
  "admin", "administrator", "api", "browse", "search", "upload", "library", "notifications", "settings",
  "login", "logout", "signup", "embed", "licenses", "dmca", "terms", "privacy", "dev", "style", "tag",
  "stash", "support", "help", "about", "root", "system", "moderator", "staff", "official", "u", "og",
  "loop", "oneshot", "kit", "midi", "preset", "null", "undefined",
]);
