import { headers } from "next/headers";
import { z } from "zod";
import type { ActionDeps } from "./action.ts";
import { createServerSupabase } from "./supabase/server.ts";

/**
 * The real dependencies of an action, from the current request.
 *
 * The origin comes from the request: Next refuses a server action whose Origin does not match
 * its Host, and Supabase Auth only redirects to URLs on its allow list (site_url and
 * additional_redirect_urls), so a forged value cannot send a sign-in link elsewhere.
 */
export const requestDeps: ActionDeps = {
  supabase: createServerSupabase,
  origin: async () => {
    const h = await headers();
    const origin = h.get("origin");
    if (origin) return z.url().parse(origin).replace(/\/+$/, "");
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    return new URL(`${proto}://${host}`).origin;
  },
};
