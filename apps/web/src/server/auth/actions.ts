"use server";

/**
 * Server actions for sign-in and the profile, for the Interface lane (ticket 133) to call.
 * Each returns Result<T>: { ok: true, data } or { ok: false, code, message, fields? }, with T
 * inferred from the contracts output schema. Inputs are `unknown` on purpose: the wrapper
 * validates them against the contracts input schemas.
 */
import type {
  Result,
  claimHandleOutput,
  signInWithEmailOutput,
  signInWithProviderOutput,
  signOutOutput,
  updateProfileOutput,
} from "@stash/contracts";
import type { z } from "zod";
import { requestDeps } from "../request-deps.ts";
import { claimHandle as claimHandleAction, updateProfile as updateProfileAction } from "./profile-actions.ts";
import { signInWithEmail as emailAction, signInWithProvider as providerAction, signOut as signOutAction } from "./sign-in.ts";

/** claimHandleInput → profile. Signed in; the first call creates the profile and account. */
export async function claimHandle(input: unknown): Promise<Result<z.output<typeof claimHandleOutput>>> {
  return claimHandleAction.run(input, requestDeps);
}

/** updateProfileInput → profile. Signed in with a claimed handle, not suspended. */
export async function updateProfile(input: unknown): Promise<Result<z.output<typeof updateProfileOutput>>> {
  return updateProfileAction.run(input, requestDeps);
}

/** signInWithEmailInput → { sent: true }. Sends a sign-in link. Pass `next` through unchanged; the server sanitizes it. */
export async function signInWithEmail(input: unknown): Promise<Result<z.output<typeof signInWithEmailOutput>>> {
  return emailAction.run(input, requestDeps);
}

/** signInWithProviderInput → { url }. Navigate the browser to url. */
export async function signInWithProvider(input: unknown): Promise<Result<z.output<typeof signInWithProviderOutput>>> {
  return providerAction.run(input, requestDeps);
}

/** Signs this browser out. */
export async function signOut(): Promise<Result<z.output<typeof signOutOutput>>> {
  return signOutAction.run(undefined, requestDeps);
}
