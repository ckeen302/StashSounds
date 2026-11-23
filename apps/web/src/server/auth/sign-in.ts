import { ok } from "@stash/contracts";
import { defineAction } from "../action.ts";
import { callbackUrl } from "./callback.ts";
import {
  signInWithEmailInput,
  signInWithEmailOutput,
  signInWithProviderInput,
  signInWithProviderOutput,
  signOutInput,
  signOutOutput,
} from "./schemas.ts";

/**
 * Email link sign-in. Creates the auth user on first use; the profile and account rows come
 * later, from claimHandle. Supabase Auth applies its own email rate limit (429 → rate_limited).
 */
export const signInWithEmail = defineAction({
  name: "signInWithEmail",
  auth: "public",
  input: signInWithEmailInput,
  output: signInWithEmailOutput,
  handler: async (input, ctx) => {
    const { error } = await ctx.supabase.auth.signInWithOtp({
      email: input.email,
      options: { emailRedirectTo: callbackUrl(await ctx.origin(), input.next), shouldCreateUser: true },
    });
    if (error) throw error;
    return ok({ sent: true as const });
  },
});

/**
 * Google or Discord. Returns the authorize URL for the browser to open; the PKCE verifier is kept
 * in a cookie this action sets, and /api/auth/callback exchanges the code.
 */
export const signInWithProvider = defineAction({
  name: "signInWithProvider",
  auth: "public",
  input: signInWithProviderInput,
  output: signInWithProviderOutput,
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase.auth.signInWithOAuth({
      provider: input.provider,
      options: { redirectTo: callbackUrl(await ctx.origin(), input.next), skipBrowserRedirect: true },
    });
    if (error) throw error;
    return ok({ url: data.url });
  },
});

/** Ends this browser's session only (other devices stay signed in). */
export const signOut = defineAction({
  name: "signOut",
  auth: "user",
  input: signOutInput,
  output: signOutOutput,
  handler: async (_input, ctx) => {
    const { error } = await ctx.supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    return ok({ signedOut: true as const });
  },
});
