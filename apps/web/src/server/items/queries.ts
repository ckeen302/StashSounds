import "server-only";
import { notFound, redirect } from "next/navigation";
import type { ItemPage } from "@stash/contracts";
import { getSession } from "../session.ts";
import { createServerSupabase } from "../supabase/server.ts";
import { getItemPage } from "./get-item-page.ts";

/**
 * For the item page (app/[type]/[slug] route, ticket 135): the page's data, read as the visitor.
 * A non-canonical URL (old slug, wrong type) redirects (307, not permanent: a renamed item can get
 * an earlier slug back, PR #9 A1) to the item's href; an unknown
 * or unpublished item renders the not-found page. `param` is the route's "slug-publicId" segment.
 */
export async function itemPage(type: string, param: string): Promise<ItemPage> {
  const [session, supabase] = await Promise.all([getSession(), createServerSupabase()]);
  const r = await getItemPage(supabase, session?.user.id ?? null, type, param);
  if (r.kind === "redirect") redirect(r.href);
  if (r.kind === "not_found") notFound();
  return r.page;
}
