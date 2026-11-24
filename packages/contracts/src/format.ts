/**
 * Pure helpers with no zod import, so pages that only format data (keys, peaks, hrefs, license
 * labels) do not ship the schema library to the browser (PR #12 script budget). Everything here is
 * also exported from "@stash/contracts"; client components import "@stash/contracts/format".
 */
import type { KeyMode, LicenseKind } from "./enums.ts";
import type { MusicalKey } from "./common.ts";
import raw from "../limits.json" with { type: "json" };

export { itemHref, parseItemParam, slugify } from "./paths.ts";

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const NOTE_INDEX: Record<string, number> = {
  c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, fb: 4, "e#": 5, f: 5, "f#": 6, gb: 6,
  g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11, cb: 11, "b#": 0,
};

/** "F#m" for F sharp minor, "Eb" for E flat major. Sharps are canonical. */
export function formatKey(key: MusicalKey): string {
  return `${SHARP_NAMES[key.root]}${key.mode === "minor" ? "m" : ""}`;
}

/**
 * Parses the ways producers write keys: "F#m", "F# minor", "Fsharpmin", "Ebmaj", "a min", "Am".
 * Returns null for anything it does not recognize. Mirrored by apps/worker key parsing.
 */
export function parseKey(input: string): MusicalKey | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "").replace("sharp", "#").replace("flat", "b").replace("♯", "#").replace("♭", "b");
  const m = /^([a-g])([#b]?)(maj(?:or)?|min(?:or)?|m)?$/.exec(s);
  if (!m) return null;
  const root = NOTE_INDEX[`${m[1]}${m[2]}`];
  if (root === undefined) return null;
  const modeToken = m[3];
  const mode: KeyMode = modeToken && modeToken.startsWith("m") && !modeToken.startsWith("maj") ? "minor" : "major";
  return { root, mode };
}

/** Keys that mix well: same key, relative major/minor, and neighbours on the circle of fifths. */
export function compatibleKeys(key: MusicalKey): MusicalKey[] {
  const relative: MusicalKey =
    key.mode === "minor" ? { root: (key.root + 3) % 12, mode: "major" } : { root: (key.root + 9) % 12, mode: "minor" };
  return [
    key,
    relative,
    { root: (key.root + 7) % 12, mode: key.mode },
    { root: (key.root + 5) % 12, mode: key.mode },
  ];
}

export function encodePeaks(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(values[i] ?? 0)));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodePeaks(encoded: string): Uint8Array {
  const bin = atob(encoded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** License labels and versions, for display. The full text lives on /licenses. */
export const LICENSE_LABELS: Record<LicenseKind, { label: string; summary: string; version: string }> = {
  royalty_free: {
    label: "Royalty-free",
    summary: "Use it in your own music, including commercial releases. Do not redistribute the raw file.",
    version: raw.licenses.royalty_free.version,
  },
  credit_required: {
    label: "Credit required",
    summary: "Same as royalty-free, and you credit the creator wherever the track is released.",
    version: raw.licenses.credit_required.version,
  },
  split_on_placement: {
    label: "Split on placement",
    summary: "Free to use. If the track is commercially released, the stated publishing share is owed to the creator.",
    version: raw.licenses.split_on_placement.version,
  },
};
