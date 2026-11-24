import type { ActionDeps } from "./action.ts";
import { originalsFromEnv } from "./storage/originals.ts";
import { createServerSupabase } from "./supabase/server.ts";
import { serviceSupabase } from "./supabase/service.ts";

/**
 * The real dependencies of an action, from the current request. Nothing here reads request
 * headers: redirect URLs come from NEXT_PUBLIC_SITE_URL (env.ts siteUrl).
 */
export const requestDeps: ActionDeps = {
  supabase: createServerSupabase,
  service: serviceSupabase,
  storage: originalsFromEnv,
};
