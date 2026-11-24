import type { SignInIntent } from "./sign-in-dialog";

/**
 * The action a visitor asked for before signing in, kept in this tab while they sign in. The
 * `?then=` on the way back only names it: the page acts when this marker, set by pressing Sign in
 * in the dialog, matches the item and the intent. A bare link with `?then=download` does nothing.
 */
export const INTENT_KEY = "stash:item-intent";
/** Long enough to read an email and press its link; short enough that an old marker cannot fire. */
export const INTENT_TTL_MS = 30 * 60 * 1000;

const INTENTS: readonly string[] = ["download", "like", "follow"] satisfies SignInIntent[];

type Marker = { intent: SignInIntent; itemId: string; at: number };

export function rememberIntent(storage: Storage | null, marker: { intent: SignInIntent; itemId: string }, now = Date.now()): void {
  try {
    storage?.setItem(INTENT_KEY, JSON.stringify({ ...marker, at: now } satisfies Marker));
  } catch {
    // Storage blocked: the visitor signs in and presses the button again.
  }
}

/** The intent to act on, or null. Any marker is cleared, whether or not it matched. */
export function takeIntent(storage: Storage | null, urlIntent: string | null, itemId: string, now = Date.now()): SignInIntent | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(INTENT_KEY);
    storage.removeItem(INTENT_KEY);
    if (!raw || !urlIntent || !INTENTS.includes(urlIntent)) return null;
    const m = JSON.parse(raw) as Partial<Marker>;
    const fresh = typeof m.at === "number" && now - m.at >= 0 && now - m.at <= INTENT_TTL_MS;
    return m.intent === urlIntent && m.itemId === itemId && fresh ? (urlIntent as SignInIntent) : null;
  } catch {
    return null;
  }
}

/** sessionStorage, or null where reading it throws (blocked site data). */
export function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
