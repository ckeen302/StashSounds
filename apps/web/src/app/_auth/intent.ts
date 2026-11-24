/**
 * A signed-out like, follow or download is remembered in the URL it returns to after sign-in:
 * `?do=like:k3j9x0a2b1`. The parameter rides `next` through the email link, the provider round trip
 * and the handle claim, and the page runs it once when a member loads it.
 *
 * The pattern is strict on purpose: a crafted link can only name one of the three kinds and a plain
 * id or handle (lowercase letters, digits, underscore and hyphen), never a path or a second value.
 */
export const INTENT_PARAM = "do";

export type IntentKind = "like" | "follow" | "download";
export type Intent = { kind: IntentKind; target: string };

const PATTERN = /^(like|follow|download):([a-z0-9_-]{1,64})$/;

export function encodeIntent(intent: Intent): string {
  return `${intent.kind}:${intent.target}`;
}

export function parseIntent(raw: string | null | undefined): Intent | null {
  const m = raw ? PATTERN.exec(raw) : null;
  return m ? { kind: m[1] as IntentKind, target: m[2]! } : null;
}

function withSearch(pathname: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/** The current path and query with `do` set to this intent (a second press replaces the first). */
export function pathWithIntent(pathname: string, search: string, intent: Intent): string {
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
