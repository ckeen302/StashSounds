import type { MidiNotesFile } from "@stash/contracts";

/**
 * Drum MIDI comes in parts: a full kit pattern, or a single part (hi-hats, kicks, snares and
 * claps, percussion). A part plays on its own drum sound whatever notes it was written on, because
 * a producer's hi-hat MIDI is often on C3 or C5 for their sampler, not on General MIDI's 42. A kit
 * on General MIDI notes plays as written; a kit on other notes is mapped by how each note is used.
 */

export type DrumPart = "kit" | "hats" | "kick" | "snare" | "perc";

export const DRUM_PART_LABEL: Record<DrumPart, string> = {
  kit: "Drum pattern",
  hats: "Hi-hats",
  kick: "Kicks",
  snare: "Snares and claps",
  perc: "Percussion",
};

// General MIDI drum notes the demo's drum voice plays.
const GM = { kick: 36, rim: 37, snare: 38, clap: 39, hat: 42, pedal: 44, open: 46, crash: 49, ride: 51, tomLow: 45, tomMid: 47, tomHigh: 50 } as const;
const GM_SET = new Set<number>([35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 55, 56, 57, 59]);

/** The part a drum file most likely is, from its name first and then from its notes. */
export function guessDrumPart(name: string, notes: MidiNotesFile["notes"]): DrumPart {
  const n = name.toLowerCase();
  // "Trap drums with hat rolls" is a kit: the word drums or kit wins over the parts it names.
  if (/\bdrums?\b|\bkit\b|\bgroove\b|\bbeat\b/.test(n)) return "kit";
  if (/hi-?hats?|\bhh\b|hats?\b|hihat|_hh|hh_/.test(n)) return "hats";
  if (/perc|shaker|conga|bongo|rim|tamb|cowbell/.test(n)) return "perc";
  if (/snare|clap/.test(n) && !/kick/.test(n)) return "snare";
  if (/kick/.test(n) && !/snare|clap|hat/.test(n)) return "kick";
  const pitches = new Set(notes.map((x) => x[2]));
  if ([...pitches].every((p) => p === GM.hat || p === GM.pedal || p === GM.open)) return "hats";
  if ([...pitches].every((p) => p === 35 || p === GM.kick)) return "kick";
  if ([...pitches].every((p) => p === GM.snare || p === GM.clap || p === 40)) return "snare";
  if (looksLikeHats(notes)) return "hats";
  return "kit";
}

/** One or two notes, short and dense (eight or more a bar): a hi-hat line, not a melody. */
export function looksLikeHats(notes: MidiNotesFile["notes"]): boolean {
  if (notes.length < 8) return false;
  const pitches = new Set(notes.map((x) => x[2]));
  const end = Math.max(...notes.map(([s, l]) => s + l));
  const perBar = notes.length / Math.max(1, end / 4);
  const short = notes.filter(([, l]) => l <= 0.3).length / notes.length;
  return pitches.size <= 2 && perBar >= 8 && short >= 0.8;
}

/** A file name that says it is drums, so a file exported on channel 1 still plays on drums. */
export function nameSaysDrums(name: string): boolean {
  const words = name.toLowerCase().replace(/\.[^.]+$/, "").split(/[^a-z]+/);
  return words.some((w) => /^(drums?|hihats?|hats?|hh|perc|percs|percussion|kicks?|snares?|claps?|grooves?|shakers?|rims?|cymbals?|toms?)$/.test(w)) || /hi-?hats?/i.test(name);
}

/**
 * The note each written note plays on, for the drum voice. `len` is the note's length in beats:
 * on a hi-hat part a long note is an open hat.
 */
export function drumMapper(notes: MidiNotesFile["notes"], part: DrumPart): (pitch: number, len: number) => number {
  const onlyGm = notes.every((x) => GM_SET.has(x[2]));
  switch (part) {
    case "hats":
      return (p, len) => (p === GM.hat || p === GM.pedal || p === GM.open ? p : len >= 0.45 ? GM.open : GM.hat);
    case "kick":
      return () => GM.kick;
    case "snare":
      return (p) => (p === GM.clap || p === GM.snare || p === 40 ? p : GM.snare);
    case "perc": {
      const order = distinct(notes);
      const sounds = [GM.rim, 70, GM.tomHigh, GM.clap, GM.tomMid, 82];
      const m = new Map(order.map((p, i) => [p, sounds[i % sounds.length]!]));
      return (p) => (onlyGm ? p : (m.get(p) ?? GM.rim));
    }
    case "kit": {
      if (onlyGm) return (p) => p;
      return kitMap(notes);
    }
  }
}

function distinct(notes: MidiNotesFile["notes"]): number[] {
  return [...new Set(notes.map((x) => x[2]))].sort((a, b) => a - b);
}

/**
 * A kit on a sampler's notes (C3 kick, D3 snare...): the lowest note is the kick, the busiest
 * short note is the hi-hat, the note landing most on beats two and four is the snare or clap,
 * and the rest share open hat, rim and toms.
 */
function kitMap(notes: MidiNotesFile["notes"]): (pitch: number, len: number) => number {
  const order = distinct(notes);
  const count = new Map<number, number>();
  const backbeat = new Map<number, number>();
  for (const [s, , p] of notes) {
    count.set(p, (count.get(p) ?? 0) + 1);
    const inBar = ((s % 4) + 4) % 4;
    if (Math.abs(inBar - 1) < 0.05 || Math.abs(inBar - 3) < 0.05) backbeat.set(p, (backbeat.get(p) ?? 0) + 1);
  }
  const m = new Map<number, number>();
  const kick = order[0]!;
  m.set(kick, GM.kick);
  const rest = order.slice(1);
  const hat = [...rest].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0))[0];
  if (hat !== undefined && (count.get(hat) ?? 0) >= 8) m.set(hat, GM.hat);
  const snare = rest.filter((p) => !m.has(p)).sort((a, b) => (backbeat.get(b) ?? 0) - (backbeat.get(a) ?? 0))[0];
  if (snare !== undefined) m.set(snare, GM.snare);
  const others = [GM.open, GM.clap, GM.rim, GM.tomLow, GM.tomMid, GM.tomHigh, GM.crash];
  let i = 0;
  for (const p of rest) if (!m.has(p)) m.set(p, others[i++ % others.length]!);
  return (p) => m.get(p) ?? p;
}

// The part each loaded notes file was posted as, so the player can map it without a new argument
// at every call site. Files with no part registered are guessed from their notes.
const PARTS = new WeakMap<MidiNotesFile, DrumPart>();

export function setDrumPart(notes: MidiNotesFile, part: DrumPart | undefined) {
  if (part) PARTS.set(notes, part);
}

export function drumPartOf(notes: MidiNotesFile): DrumPart {
  return PARTS.get(notes) ?? guessDrumPart("", notes.notes);
}
