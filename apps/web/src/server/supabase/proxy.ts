import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "../env.ts";

/**
 * Refreshes the Supabase session cookie before a page renders. Meant to be called from
 * apps/web/src/proxy.ts (Next 16's renamed middleware), which is requested in
 * docs/requests/101-session-proxy-and-auth-config.md:
 *
 *   export function proxy(request: NextRequest) { return updateSession(request); }
 *   export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg|robots.txt).*)"] };
 *
 * It does not redirect anyone; pages decide with getSession() and requireUser().
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = publicEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        // Responses that set auth cookies must never be cached for someone else.
        for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
      },
    },
  });
  // Validates the token with Supabase Auth and triggers the refresh (and setAll) when it is due.
  await supabase.auth.getUser();
  return response;
}
