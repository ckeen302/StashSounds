import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";

export const CALLBACK_PATH = "/api/auth/callback";

/**
 * A path on this site, or "/". Blocks absolute and protocol-relative URLs ("//evil", "/\evil"),
 * control characters (raw or percent-encoded) and the callback itself.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(next) || /%(0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(next)) return "/";
  if (next === CALLBACK_PATH || next.startsWith(`${CALLBACK_PATH}?`) || next.startsWith(`${CALLBACK_PATH}/`)) return "/";
  return next;
}

/** The URL Supabase sends the user back to after an email link or a provider sign-in. */
export function callbackUrl(origin: string, next: string | undefined): string {
  return `${origin}${CALLBACK_PATH}?next=${encodeURIComponent(safeNextPath(next))}`;
}

/** Email link types this callback accepts. Password recovery is not a Stash flow. */
const EMAIL_TYPES = new Set<EmailOtpType>(["magiclink", "signup", "email", "email_change"]);

/**
 * GET /api/auth/callback. Completes sign-in from a PKCE code (Google, Discord, and email links
 * through Supabase's default template) or an email token hash (a custom template), and returns
 * the path to redirect to:
 * - the sanitized `next` for a user with a claimed handle;
 * - /login?next=... for a new user, who claims a handle there before anything else;
 * - /login?error=signin_failed[&next=...] when sign-in did not complete.
 */
export async function handleAuthCallback(url: URL, supabase: SupabaseClient): Promise<string> {
  const q = url.searchParams;
  const next = safeNextPath(q.get("next"));
  const failed = `/login?error=signin_failed${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;

  const code = q.get("code");
  const tokenHash = q.get("token_hash");
  const type = q.get("type") as EmailOtpType | null;

  let userId: string | null = null;
  if (q.get("error")) return failed;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) return failed;
    userId = data.user.id;
  } else if (tokenHash && type && EMAIL_TYPES.has(type)) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error || !data.user) return failed;
    userId = data.user.id;
  } else {
    return failed;
  }

  const { data: profile, error } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (error) throw error;
  return profile ? next : `/login?next=${encodeURIComponent(next)}`;
}
