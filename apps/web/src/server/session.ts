import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "./supabase/server.ts";
import { loadSession, type Session } from "./session-core.ts";

export type { MemberSession, Session } from "./session-core.ts";

/**
 * The signed-in user with their profile and account, or null when signed out. `profile: null`
 * means the handle is not claimed yet: send them to /login to claim it. Cached per request.
 */
export const getSession = cache(async (): Promise<Session | null> => loadSession(await createServerSupabase()));

/** Like getSession, but a signed-out visitor is redirected to /login (with `next` to come back to). */
export async function requireUser(opts: { next?: string } = {}): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(opts.next ? `/login?next=${encodeURIComponent(opts.next)}` : "/login");
  return session;
}
