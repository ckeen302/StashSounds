/**
 * A signed-out action (like, follow, download, or any kind a page registers) is carried through
 * sign-in in the URL it returns to: `?do=<kind>:<target>:<nonce>`. The parameter rides `next`
 * through the email link, the provider round trip and the handle claim.
 *
 * The URL alone never runs anything. The nonce must match the record this browser stored when the
 * sign-in dialog opened (intent-store.ts), so a link someone posts (`?do=follow:attacker`) does
 * nothing for a member who opens it (PR #14 review, blocking).
 *
 * The pattern is strict: a lowercase kind, a plain id or handle (lowercase letters, digits,
 * underscore and hyphen) and a 128-bit hex nonce; never a path or a fourth value.
 */
export const INTENT_PARAM = "do";

/** What to run: kind names the action a page registered, target its subject (public id, handle). */
export type Intent = { kind: string; target: string };
/** An intent with the nonce that ties it to this browser's stored record. */
export type PendingIntent = Intent & { nonce: string };

const PATTERN = /^([a-z]{1,16}):([a-z0-9_-]{1,64}):([0-9a-f]{32})$/;

export function encodeIntent(intent: PendingIntent): string {
  return `${intent.kind}:${intent.target}:${intent.nonce}`;
}

export function parseIntent(raw: string | null | undefined): PendingIntent | null {
  const m = raw ? PATTERN.exec(raw) : null;
  return m ? { kind: m[1]!, target: m[2]!, nonce: m[3]! } : null;
}

function withSearch(pathname: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/** The current path and query with `do` set to this intent (a second press replaces the first). */
export function pathWithIntent(pathname: string, search: string, intent: PendingIntent): string {
  const params = new URLSearchParams(search);
  params.delete(INTENT_PARAM);
  params.append(INTENT_PARAM, encodeIntent(intent));
  return withSearch(pathname, params);
}

/** The same path without `do`, once the action has run. */
export function pathWithoutIntent(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(INTENT_PARAM);
  return withSearch(pathname, params);
}
