/**
 * The volume setting is remembered (design spec, Accessibility: Sound). It is a per-browser
 * convenience, so it lives in localStorage; storage that is missing or blocked only means the
 * engine's default (0.8) is used.
 */
export const VOLUME_KEY = "stash.volume";

type Store = Pick<Storage, "getItem" | "setItem">;

export function readVolume(storage: Pick<Storage, "getItem"> | null): number | null {
  try {
    const raw = storage?.getItem(VOLUME_KEY);
    if (raw == null) return null;
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    return Math.min(1, Math.max(0, v));
  } catch {
    return null;
  }
}

export function writeVolume(storage: Pick<Store, "setItem"> | null, volume: number): void {
  try {
    storage?.setItem(VOLUME_KEY, String(volume));
  } catch {
    // Blocked storage: the setting lasts for this visit only.
  }
}

/** localStorage, or null where reading it throws (blocked site data, some private windows). */
export function browserStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
