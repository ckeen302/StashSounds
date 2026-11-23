"use server";

/**
 * Server actions for sign-in and the profile, for the Interface lane (ticket 133) to call.
 * Each returns Result<T>: { ok: true, data } or { ok: false, code, message, fields? }.
 * Inputs are `unknown` on purpose: the wrapper validates them against the contracts schemas.
 */
import type { Profile, Result } from "@stash/contracts";
import { requestDeps } from "../request-deps.ts";
import { claimHandle as claimHandleAction, updateProfile as updateProfileAction } from "./profile-actions.ts";
import { signInWithEmail as emailAction, signInWithProvider as providerAction, signOut as signOutAction } from "./sign-in.ts";

/** claimHandleInput → Profile. Signed in; the first call creates the profile and account. */
export async function claimHandle(input: unknown): Promise<Result<Profile>> {
  return claimHandleAction.run(input, requestDeps);
}

/** updateProfileInput → Profile. Signed in with a claimed handle, not suspended. */
export async function updateProfile(input: unknown): Promise<Result<Profile>> {
  return updateProfileAction.run(input, requestDeps);
}

/** { email, next? } → { sent: true }. Sends a sign-in link. */
export async function signInWithEmail(input: unknown): Promise<Result<{ sent: true }>> {
  return emailAction.run(input, requestDeps);
}

/** { provider: "google" | "discord", next? } → { url }. Navigate the browser to url. */
export async function signInWithProvider(input: unknown): Promise<Result<{ url: string }>> {
  return providerAction.run(input, requestDeps);
}

/** Signs this browser out. */
export async function signOut(): Promise<Result<{ signedOut: true }>> {
  return signOutAction.run(undefined, requestDeps);
}
