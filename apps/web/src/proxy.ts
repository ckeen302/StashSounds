import type { NextRequest } from "next/server";
import { updateSession } from "@/server/supabase/proxy";

/**
 * Next 16 proxy (formerly middleware). Refreshes the Supabase session cookie before a page
 * renders, because Server Components cannot write cookies. It redirects nobody: pages decide with
 * getSession() and requireUser().
 */
export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|robots.txt).*)"],
};
