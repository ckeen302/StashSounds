import { nextPathSchema } from "@stash/contracts";

export const CALLBACK_PATH = "/api/auth/callback";

/**
 * The only safe way to turn a `next` value (query string, form field) into a redirect target
 * after sign-in: a path on this site, or "/". Blocks absolute and protocol-relative URLs
 * ("//evil", "/\evil"), backslashes and control characters (raw or percent-encoded) and the
 * callback itself. Pure, so Client Components may import it from "@/server/auth/next-path".
 */
export function safeNextPath(next: unknown): string {
  const parsed = nextPathSchema.safeParse(next);
  if (!parsed.success) return "/";
  const p = parsed.data;
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(p) || /%(0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(p)) return "/";
  if (p === CALLBACK_PATH || p.startsWith(`${CALLBACK_PATH}?`) || p.startsWith(`${CALLBACK_PATH}/`)) return "/";
  return p;
}
