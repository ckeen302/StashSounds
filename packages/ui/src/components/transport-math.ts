import type { MusicalKey } from "@stash/contracts";
import { formatKey } from "@stash/contracts/format";
import limits from "@stash/contracts/limits.json" with { type: "json" };

/** The engine clamps a key shift to one octave either way (packages/audio setTranspose). */
export const TRANSPOSE_LIMIT = 12;

/** The key a shift lands on: Dm up 2 is Em. Null when the key is not known. */
export function transposedKey(key: MusicalKey | null | undefined, semitones: number): string | null {
  if (!key) return null;
  const root = (((key.root + Math.round(semitones)) % 12) + 12) % 12;
  return formatKey({ root, mode: key.mode });
}

/** A shift with its sign: "+3", "−2" (the true minus sign, so digits line up), "0". */
export function semitoneText(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

/** The tempo slider runs from half to double speed, inside the contract's BPM range. */
export function tempoRange(baseBpm: number): { min: number; max: number } {
  return {
    min: Math.max(limits.bpm.min, Math.round(baseBpm / 2)),
    max: Math.min(limits.bpm.max, Math.round(baseBpm * 2)),
  };
}

/** "Em, up 2 semitones": what a screen reader hears for a key shift. */
export function keyShiftText(key: string | null, semitones: number): string {
  const shift =
    semitones === 0 ? "original key" : `${semitones > 0 ? "up" : "down"} ${Math.abs(semitones)} ${Math.abs(semitones) === 1 ? "semitone" : "semitones"}`;
  return key ? `${key}, ${shift}` : shift;
}
