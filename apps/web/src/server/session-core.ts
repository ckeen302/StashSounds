import { isAuthError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import type { Account, Profile } from "@stash/contracts";
import { ACCOUNT_COLUMNS, PROFILE_COLUMNS, toAccount, toProfile, type AccountRow, type ProfileRow } from "./profile.ts";

/**
 * Who is signed in. `profile` and `account` are null until the user claims a handle (claim_handle
 * creates both), and a new user must do that before anything else.
 */
export type Session = {
  user: { id: string; email: string | null; emailVerified: boolean };
  profile: Profile | null;
  account: Account | null;
};
/** A session whose handle is claimed. */
export type MemberSession = Session & { profile: Profile; account: Account };

/**
 * Reads the session from a Supabase client. Uses auth.getUser, which asks Supabase Auth to
 * validate the token, rather than trusting the cookie's contents.
 */
export async function loadSession(supabase: SupabaseClient): Promise<Session | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    // No cookie, or a token Auth rejects: signed out. Anything else (an outage) is not.
    if (isAuthSessionMissingError(error) || (isAuthError(error) && [400, 401, 403].includes(error.status ?? 0))) return null;
    throw error;
  }
  const authUser = data.user;
  if (!authUser) return null;

  const emailVerified = Boolean(authUser.email_confirmed_at);
  const [p, a] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", authUser.id).maybeSingle<ProfileRow>(),
    supabase.from("accounts").select(ACCOUNT_COLUMNS).eq("id", authUser.id).maybeSingle<AccountRow>(),
  ]);
  if (p.error) throw p.error;
  if (a.error) throw a.error;

  return {
    user: { id: authUser.id, email: authUser.email ?? null, emailVerified },
    profile: p.data ? toProfile(p.data) : null,
    account: a.data ? toAccount(a.data, emailVerified) : null,
  };
}

export function isMember(s: Session | null): s is MemberSession {
  return Boolean(s?.profile && s.account);
}
