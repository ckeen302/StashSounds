import { NextResponse, type NextRequest } from "next/server";
import { authCallback } from "@/server";

export const dynamic = "force-dynamic";

/** Where Supabase Auth sends the browser after an email link or a Google or Discord sign-in. */
export async function GET(request: NextRequest) {
  const path = await authCallback(new URL(request.url));
  const response = NextResponse.redirect(new URL(path, request.url));
  // This response carries the new session cookies: never cache it.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
