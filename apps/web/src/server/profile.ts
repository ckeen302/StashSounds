import { z } from "zod";
import {
  accountSchema,
  bioSchema,
  displayNameSchema,
  limits,
  profileLinkSchema,
  profileSchema,
  type Account,
  type Profile,
  type ProfileLink,
} from "@stash/contracts";
import { publicEnv } from "./env.ts";

/** Columns of public.profiles and public.accounts as PostgREST returns them. Database rows, not contracts. */
export type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_path: string | null;
  links: unknown;
  followers_count: number;
  following_count: number;
  created_at: string;
};
export type AccountRow = { id: string; role: string; storage_bytes: number; strikes: number; suspended_at: string | null };

/** Column lists for selects: name columns, never `*`, so a new private column is not exposed by accident. */
export const PROFILE_COLUMNS = "id, handle, display_name, bio, avatar_path, links, followers_count, following_count, created_at";
export const ACCOUNT_COLUMNS = "id, role, storage_bytes, strikes, suspended_at";

/** Public URL of an object in the previews bucket. */
export function previewUrl(path: string): string {
  return `${publicEnv().previewsBaseUrl}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * A profile row in its contracts shape. The database's checks are looser than profileSchema in a
 * few places (a link kind outside the enum, a display name of only spaces), so those fields
 * degrade instead of failing the whole page for that user: invalid links are dropped, the display
 * name falls back to the handle, a bad bio or avatar becomes null. Each degrade is logged with the
 * profile id and field names only. Columns the database checks exactly (id, handle, counts,
 * created_at) still throw if they ever break the contract, because that is a schema bug.
 */
export function toProfile(row: ProfileRow): Profile {
  const degraded: string[] = [];

  const rawLinks = Array.isArray(row.links) ? row.links : [];
  if (!Array.isArray(row.links) && row.links != null) degraded.push("links");
  const links: ProfileLink[] = [];
  for (const l of rawLinks) {
    const r = profileLinkSchema.safeParse(l);
    if (r.success && links.length < 8) links.push(r.data);
    else degraded.push("links");
  }

  const displayName = displayNameSchema.safeParse(row.display_name);
  if (!displayName.success) degraded.push("displayName");
  const bio = bioSchema.nullable().safeParse(row.bio);
  if (!bio.success) degraded.push("bio");
  const avatarUrl = row.avatar_path ? z.url().safeParse(previewUrl(row.avatar_path)) : null;
  if (avatarUrl && !avatarUrl.success) degraded.push("avatarUrl");

  if (degraded.length) console.warn(`profile ${row.id}: dropped invalid ${[...new Set(degraded)].join(", ")}`);

  return profileSchema.parse({
    id: row.id,
    handle: row.handle,
    displayName: displayName.success ? displayName.data : row.handle,
    bio: bio.success ? bio.data : null,
    avatarUrl: avatarUrl?.success ? avatarUrl.data : null,
    links,
    followersCount: row.followers_count,
    followingCount: row.following_count,
    createdAt: row.created_at,
  });
}

/** The quota mirrors create_upload_draft: trusted and admin accounts get the larger one. */
export function toAccount(row: AccountRow, emailVerified: boolean): Account {
  const trusted = row.role === "trusted" || row.role === "admin";
  return accountSchema.parse({
    id: row.id,
    role: row.role,
    storageBytes: Number(row.storage_bytes),
    storageQuotaBytes: trusted ? limits.quota.storageBytesTrusted : limits.quota.storageBytes,
    strikes: row.strikes,
    suspendedAt: row.suspended_at,
    emailVerified,
  });
}
