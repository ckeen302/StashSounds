import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { nextPathSchema } from "@stash/contracts";
import { CALLBACK_PATH, safeNextPath } from "./next-path.ts";

export { CALLBACK_PATH, safeNextPath } from "./next-path.ts";

/** The URL Supabase sends the user back to after an email link or a provider sign-in. */
export function callbackUrl(origin: string, next: string | undefined): string {
  return `${origin}${CALLBACK_PATH}?next=${encodeURIComponent(safeNextPath(next))}`;
}

/**
 * The callback's query string. Only the PKCE code flow is accepted: the code is useless without
 * the verifier cookie set in this browser by signInWithEmail or signInWithProvider, which is what
 * stops login CSRF (signing a victim into the attacker's account with a link the attacker made).
 * A bad `next` falls back to "/" instead of failing the sign-in.
 */
const callbackQuerySchema = z.object({
  /** A missing, empty or oversized code is no code. */
  code: z.string().min(1).max(1024).optional().catch(undefined),
  next: nextPathSchema.optional().catch(undefined),
  /** Set by the provider when the user cancels or sign-in fails; any value, even malformed, is a failure. */
  error: z.string().max(500).optional().catch("malformed"),
});

/**
 * GET /api/auth/callback. Exchanges the PKCE code (Google, Discord, and email links through
 * Supabase's default template), and returns the path to redirect to:
 * - the sanitized `next` for a user with a claimed handle;
 * - /login?next=... for a new user, who claims a handle there before anything else;
 * - /login?error=signin_failed[&next=...] when sign-in did not complete.
 */
export async function handleAuthCallback(url: URL, supabase: SupabaseClient): Promise<string> {
  const raw = Object.fromEntries(url.searchParams);
  const query = callbackQuerySchema.parse(raw); // every field falls back, so this never throws
  const next = safeNextPath(query.next);
  const failed = `/login?error=signin_failed${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;
  if (query.error !== undefined || !query.code) return failed;

  const { data, error } = await supabase.auth.exchangeCodeForSession(query.code);
  if (error || !data.user) return failed;

  const { data: profile, error: readError } = await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  if (readError) throw readError;
  return profile ? next : `/login?next=${encodeURIComponent(next)}`;
}
