import { accountSchema, limits, profileSchema, type Account, type Profile } from "@stash/contracts";
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

export function toProfile(row: ProfileRow): Profile {
  return profileSchema.parse({
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_path ? previewUrl(row.avatar_path) : null,
    links: row.links ?? [],
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
