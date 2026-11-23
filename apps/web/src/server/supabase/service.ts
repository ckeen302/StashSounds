import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicEnv } from "../env.ts";

/**
 * Service-role client: bypasses row-level security. Server only, and only for the narrow
 * service-role functions (enqueue_processing) and writes users may not make (item_files.meta for a
 * multipart upload id). Reads a user could make go through their own client so policies apply.
 */
let cached: SupabaseClient | null = null;

export function serviceSupabase(): SupabaseClient {
  if (cached) return cached;
  const key = z.string().min(1).safeParse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key.success) throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY. See .env.example.");
  cached = createClient(publicEnv().supabaseUrl, key.data, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}
