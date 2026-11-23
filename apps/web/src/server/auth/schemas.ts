import { z } from "zod";

/**
 * Sign-in shapes that packages/contracts does not have yet. Proposed in
 * docs/requests/101-sign-in-contracts.md; delete this file and import from @stash/contracts once
 * the lead adds them.
 */

/** A same-site path to return to after sign-in. Anything else is replaced by "/" where it is used. */
export const nextPathSchema = z.string().max(500);

export const signInWithEmailInput = z.object({ email: z.email().max(320), next: nextPathSchema.optional() });
export const signInWithEmailOutput = z.object({ sent: z.literal(true) });

export const signInProviderSchema = z.enum(["google", "discord"]);
export const signInWithProviderInput = z.object({ provider: signInProviderSchema, next: nextPathSchema.optional() });
/** The provider's authorize URL. The browser navigates to it. */
export const signInWithProviderOutput = z.object({ url: z.url() });

export const signOutInput = z.object({});
export const signOutOutput = z.object({ signedOut: z.literal(true) });
