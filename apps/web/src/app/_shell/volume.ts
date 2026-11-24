/**
 * The volume setting is remembered (design spec, Accessibility: Sound). It is a per-browser
 * convenience, so it lives in localStorage; storage that is missing or blocked only means the
 * engine's default (0.8) is used.
 */
export const VOLUME_KEY = "stash.volume";
/** The level from before a mute, so unmute after a reload comes back to it rather than the default. */
export const UNMUTE_KEY = "stash.volume.unmute";

type Store = Pick<Storage, "getItem" | "setItem">;

/** A stored level from 0 to 1. Missing, blank (Number("") is 0, which would mute) or malformed is no value. */
function readLevel(storage: Pick<Storage, "getItem"> | null, key: string): number | null {
  try {
    const raw = storage?.getItem(key);
    if (raw == null || raw.trim() === "") return null;
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    return Math.min(1, Math.max(0, v));
  } catch {
    return null;
  }
}

export function readVolume(storage: Pick<Storage, "getItem"> | null): number | null {
  return readLevel(storage, VOLUME_KEY);
}

/** The level to unmute to, or null: a stored 0 is no level to come back to. */
export function readUnmuteVolume(storage: Pick<Storage, "getItem"> | null): number | null {
  const v = readLevel(storage, UNMUTE_KEY);
  return v ? v : null;
}

/** Stores the new volume and, when it is a mute (an audible level going to 0), the level it left. */
export function rememberVolume(storage: Pick<Store, "setItem"> | null, previous: number, next: number): void {
  writeVolume(storage, next);
  if (next !== 0 || !(previous > 0)) return;
  try {
    storage?.setItem(UNMUTE_KEY, String(previous));
  } catch {
    // Blocked storage: unmute falls back to the player's own memory for this visit.
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
