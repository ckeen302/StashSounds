import {
  RESERVED_HANDLES,
  claimHandleInput,
  claimHandleOutput,
  err,
  ok,
  updateProfileInput,
  updateProfileOutput,
} from "@stash/contracts";
import { defineAction } from "../action.ts";
import { mapError } from "../errors.ts";
import { PROFILE_COLUMNS, toProfile, type ProfileRow } from "../profile.ts";

const TAKEN = "That handle is taken.";

/**
 * claimHandle: creates the caller's profile and account on first call, changes the handle after.
 * Signed in, handle not needed yet (auth "user"). claim_handle in the database checks format,
 * reserved words, uniqueness and suspension again and acts only on auth.uid().
 */
export const claimHandle = defineAction({
  name: "claimHandle",
  auth: "user",
  input: claimHandleInput,
  output: claimHandleOutput,
  handler: async (input, ctx) => {
    // Same answer as the database, without a round trip.
    if (RESERVED_HANDLES.has(input.handle)) return err("conflict", TAKEN, { handle: TAKEN });

    const { data, error } = await ctx.supabase.rpc("claim_handle", {
      p_handle: input.handle,
      p_display_name: input.displayName ?? null,
    });
    if (error) {
      const mapped = mapError(error);
      // The handle form shows these next to the field.
      if (mapped?.code === "conflict") return err("conflict", TAKEN, { handle: TAKEN });
      if (mapped?.code === "invalid") return err("invalid", mapped.message, { handle: mapped.message });
      throw error;
    }
    return ok(toProfile(data as ProfileRow));
  },
});

/**
 * updateProfile: display name, bio, links and avatar on the caller's own row. Handle changes go
 * through claimHandle. The profiles_update policy and the column grants enforce the same in the
 * database; check constraints repeat the link and avatar rules.
 */
export const updateProfile = defineAction({
  name: "updateProfile",
  auth: "member",
  input: updateProfileInput,
  output: updateProfileOutput,
  handler: async (input, ctx) => {
    const uid = ctx.session.user.id;
    const patch: Partial<Pick<ProfileRow, "display_name" | "bio" | "links" | "avatar_path">> = {};
    if (input.displayName !== undefined) patch.display_name = input.displayName;
    if (input.bio !== undefined) patch.bio = input.bio;
    if (input.links !== undefined) patch.links = input.links;
    if (input.avatarPath !== undefined) {
      if (input.avatarPath !== null && !isOwnAvatarPath(input.avatarPath, uid)) {
        const message = "Upload the avatar again.";
        return err("invalid", message, { avatarPath: message });
      }
      patch.avatar_path = input.avatarPath;
    }
    if (Object.keys(patch).length === 0) return ok(ctx.session.profile);

    const { data, error } = await ctx.supabase.from("profiles").update(patch).eq("id", uid).select(PROFILE_COLUMNS).maybeSingle<ProfileRow>();
    if (error) throw error;
    if (!data) return err("not_found", "Profile not found.");
    return ok(toProfile(data));
  },
});

/** Mirrors public.safe_path(path, '<uid>/'): under the owner's folder, no dot segments, no doubled or back slashes. */
function isOwnAvatarPath(path: string, uid: string): boolean {
  return (
    path.startsWith(`${uid}/`) &&
    !/(^|\/)\.{1,2}(\/|$)/.test(path) &&
    !path.includes("//") &&
    !/[\\\u0000-\u001f\u007f]/.test(path)
  );
}
