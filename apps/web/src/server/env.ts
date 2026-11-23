import { z } from "zod";

/**
 * Settings the browser may see. Each NEXT_PUBLIC_ name is read literally so Next inlines it into
 * the browser bundle. Values come from .env.local (see .env.example; `pnpm dev` fills them).
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_PREVIEWS_BASE_URL: z.url().transform((u) => u.replace(/\/+$/, "")),
});

export type PublicEnv = { supabaseUrl: string; supabaseAnonKey: string; previewsBaseUrl: string };

export function publicEnv(): PublicEnv {
  const r = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_PREVIEWS_BASE_URL: process.env.NEXT_PUBLIC_PREVIEWS_BASE_URL,
  });
  if (!r.success) {
    // Name the variables, never echo their values.
    const names = [...new Set(r.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Missing or invalid environment variables: ${names}. See .env.example.`);
  }
  return {
    supabaseUrl: r.data.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: r.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    previewsBaseUrl: r.data.NEXT_PUBLIC_PREVIEWS_BASE_URL,
  };
}
