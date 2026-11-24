import { createServerSupabase } from "../supabase/server.ts";
import { handleAuthCallback } from "./callback.ts";

/** GET /api/auth/callback with this request's cookie-bound client. Returns the path to redirect to. */
export async function authCallback(url: URL): Promise<string> {
  return handleAuthCallback(url, await createServerSupabase());
}
