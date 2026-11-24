import type { Intent, PendingIntent } from "./intent";

/**
 * The one pending signed-out action, kept in localStorage: it has to survive the sign-in link
 * opening in a new tab, which sessionStorage would not. Written when the sign-in dialog opens,
 * claimed once when the page comes back with the matching nonce, and gone after 15 minutes.
 * Generic over kind and target, so any page's gated action can use it (the loop page's too).
 */
export const INTENT_KEY = "stash.intent";
export const INTENT_TTL_MS = 15 * 60 * 1000;

type StoredIntent = PendingIntent & { expiresAt: number };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 128 random bits as hex. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stores this intent as the pending one (replacing any other) and returns it with its nonce. */
export function rememberIntent(storage: Store | null, intent: Intent, now = Date.now()): PendingIntent {
  const pending = { kind: intent.kind, target: intent.target, nonce: newNonce() };
  try {
    storage?.setItem(INTENT_KEY, JSON.stringify({ ...pending, expiresAt: now + INTENT_TTL_MS } satisfies StoredIntent));
  } catch {
    // Blocked storage: the action will not replay after sign-in. Nothing else breaks.
  }
  return pending;
}

function read(storage: Store | null): StoredIntent | null {
  try {
    const raw = storage?.getItem(INTENT_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<StoredIntent>;
    const ok = typeof r.kind === "string" && typeof r.target === "string" && typeof r.nonce === "string" && typeof r.expiresAt === "number";
    return ok ? (r as StoredIntent) : null;
  } catch {
    return null;
  }
}

function clear(storage: Store | null) {
  try {
    storage?.removeItem(INTENT_KEY);
  } catch {
    // Nothing to do: an unreadable record never matches.
  }
}

/**
 * The intent to run, when `pending` (from the URL) matches the stored record in kind, target and
 * nonce and has not expired; the record is cleared so it runs once. A link that does not match
 * leaves a real pending record alone.
 */
export function claimIntent(storage: Store | null, pending: PendingIntent, now = Date.now()): Intent | null {
  const r = read(storage);
  if (!r) return null;
  if (r.expiresAt <= now) {
    clear(storage);
    return null;
  }
  if (r.kind !== pending.kind || r.target !== pending.target || r.nonce !== pending.nonce) return null;
  clear(storage);
  return { kind: r.kind, target: r.target };
}

/** localStorage, or null where reading it throws. */
export function intentStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
