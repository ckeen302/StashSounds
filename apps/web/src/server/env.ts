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

/**
 * The site's own origin, e.g. https://stash.example. Sign-in links and provider redirects are
 * built from it, never from request headers (Host, Origin and X-Forwarded-* are client-controlled).
 * Validated on its own so a missing value breaks only sign-in, not every page.
 */
const siteUrlSchema = z
  .url({ protocol: /^https?$/ })
  .refine((u) => {
    // Zod runs refinements after a failed url check too, so guard the parse.
    if (!URL.canParse(u)) return false;
    const url = new URL(u);
    return url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  }, "an origin only: scheme, host and port")
  .transform((u) => new URL(u).origin);

export function siteUrl(): string {
  const r = siteUrlSchema.safeParse(process.env.NEXT_PUBLIC_SITE_URL);
  if (!r.success) throw new Error("Missing or invalid environment variable: NEXT_PUBLIC_SITE_URL. See .env.example.");
  return r.data;
}

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
