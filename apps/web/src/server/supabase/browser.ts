import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "../env.ts";

/**
 * Supabase client for the browser, sharing the session cookie with the server. One instance per
 * tab. The build spec keeps data access on the server, so the browser uses this only for auth
 * state (for example onAuthStateChange to refresh the page after sign-in in another tab).
 */
export function createBrowserSupabase(): SupabaseClient {
  const env = publicEnv();
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
