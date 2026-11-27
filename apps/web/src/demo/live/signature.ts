/**
 * A producer's signature: a pad colour and a line for their screen. Every upload carries it, so a
 * loop, a kit or a MIDI file reads as theirs before the name does. Producers in the demo start with
 * one picked from their handle; the visitor sets their own on their profile (kept in this browser).
 */

export const SIG_COLORS = [
  { id: "hot", name: "Orange" },
  { id: "red", name: "Red" },
  { id: "pink", name: "Pink" },
  { id: "violet", name: "Violet" },
  { id: "blue", name: "Blue" },
  { id: "cyan", name: "Cyan" },
  { id: "lime", name: "Lime" },
  { id: "gold", name: "Gold" },
] as const;
export type SigColor = (typeof SIG_COLORS)[number]["id"];

export type Signature = { color: SigColor; message: string };

/** The longest line a screen shows without scrolling twice. */
export const SIG_MAX = 28;

const MESSAGES = [
  "TAG ME IF YOU FLIP IT",
  "COOKED IN ONE TAKE",
  "BOUNCE IS THE LAW",
  "LATE NIGHT SESSIONS ONLY",
  "KEEP IT DUSTY",
  "808 OR NOTHING",
  "FLIP IT. CREDIT IT.",
  "FRESH OUT THE STUDIO",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The signature a producer starts with, from their handle: stable, and spread over the colours. */
export function defaultSignature(handle: string): Signature {
  // Stash's own account wears the machine's one orange light.
  if (handle.toLowerCase() === "stash") return { color: "hot", message: "FREE TO FLIP. MADE ON SP-1" };
  const h = hash(handle.toLowerCase());
  return { color: SIG_COLORS[h % SIG_COLORS.length]!.id, message: MESSAGES[(h >>> 8) % MESSAGES.length]! };
}

/** A typed line made safe for the screen: upper case, plain characters, one space between words. */
export function cleanMessage(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9 .,!?'&#@/+\-:]/g, "")
    .replace(/\s+/g, " ")
    .trimStart()
    .slice(0, SIG_MAX);
}

/** Reads a stored signature, or null when it is missing or not one. */
export function parseSignature(raw: string | null): Signature | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Signature>;
    if (!SIG_COLORS.some((c) => c.id === v.color) || typeof v.message !== "string") return null;
    return { color: v.color as SigColor, message: cleanMessage(v.message).trim() };
  } catch {
    return null;
  }
}

/** The CSS custom property value for a colour (machine.css defines --sp-sig-*). */
export function sigVar(c: SigColor): string {
  return `var(--sp-sig-${c})`;
}
