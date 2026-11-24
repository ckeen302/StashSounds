import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv } from "../env.ts";

/**
 * Supabase client bound to this request's cookies, acting as the signed-in user (anon key plus
 * their JWT, so row-level security applies). Create one per request; never share it.
 *
 * Server Components cannot set cookies, so a token refreshed while rendering is not written back
 * there; the proxy (updateSession in ./proxy.ts) refreshes it before rendering instead. Server
 * actions and route handlers do write cookies.
 */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const env = publicEnv();
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}
