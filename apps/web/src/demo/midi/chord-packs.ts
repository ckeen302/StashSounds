import type { MidiNotesFile, MusicalKey } from "@stash/contracts";
import { parseKey } from "@stash/contracts/format";
import trap from "./chord-packs/trap.json" with { type: "json" };
import rage from "./chord-packs/rage.json" with { type: "json" };
import plugg from "./chord-packs/plugg.json" with { type: "json" };
import rnb from "./chord-packs/rnb.json" with { type: "json" };
import neosoul from "./chord-packs/neosoul.json" with { type: "json" };
import drill from "./chord-packs/drill.json" with { type: "json" };
import lofi from "./chord-packs/lofi.json" with { type: "json" };
import global from "./chord-packs/global.json" with { type: "json" };

/**
 * The chord packs: original, voiced chord progressions written for the demo (chord-packs/*.json,
 * checked by scripts/check-chord-packs.py), grouped into named packs by style. Each chord carries
 * its own voicing, so the notes here are exactly the ones written; the rhythm preset only decides
 * when they are struck.
 */

export type ChordPackRhythm = "held" | "roll" | "push" | "stabs" | "pulse" | "arp" | "bounce";

export type ChordPack = { name: string; style: string; description: string };

export type PackProgression = {
  title: string;
  pack: string;
  bpm: number;
  key: string;
  tags: string[];
  rhythm: ChordPackRhythm;
  /** [symbol, beats, MIDI notes low to high with the bass first]. */
  chords: [string, number, number[]][];
  top?: [number, number, number][];
  description: string;
};

type PackFile = { packs: ChordPack[]; progressions: PackProgression[] };

const FILES = [trap, rage, plugg, rnb, neosoul, drill, lofi, global] as unknown as PackFile[];

export const CHORD_PACKS: ChordPack[] = FILES.flatMap((f) => f.packs);

/** Every progression, titles made unique (a repeat across files gets its pack's name). */
export const PACK_PROGRESSIONS: PackProgression[] = (() => {
  const seen = new Set<string>();
  return FILES.flatMap((f) => f.progressions).map((p) => {
    let title = p.title.trim();
    if (seen.has(title.toLowerCase())) title = `${title} (${p.pack})`;
    seen.add(title.toLowerCase());
    return { ...p, title };
  });
})();

export function packKey(p: PackProgression): MusicalKey | null {
  return parseKey(p.key.replace(/\s+/g, ""));
}

type N = [number, number, number, number];

/** Where in a chord of `beats` beats each preset strikes: [start, length] pairs for the upper voices. */
function hits(rhythm: ChordPackRhythm, beats: number, bpm: number): [number, number][] {
  const per = (pattern: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (let bar = 0; bar < beats; bar += 4)
      for (const [s, l] of pattern) if (bar + s < beats) out.push([bar + s, Math.min(l, beats - bar - s)]);
    return out;
  };
  switch (rhythm) {
    case "stabs":
      return per([[0, 0.5], [0.75, 0.4], [1.5, 0.4], [2.5, 0.5], [3.25, 0.4]]);
    case "pulse":
      return per([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((s): [number, number] => [s, 0.38]));
    case "bounce":
      return per([[0, 1.35], [1.5, 0.4], [2, 1.35], [3.5, 0.4]]);
    case "arp": {
      const step = bpm < 110 ? 0.25 : 0.5;
      const out: [number, number][] = [];
      for (let t = 0; t < beats - 0.001; t += step) out.push([t, step * 0.95]);
      return out;
    }
    default:
      return [[0, beats]];
  }
}

/** The progression as a notes file: the written voicings, struck in the preset's rhythm, with the bass held. */
export function packNotes(p: PackProgression): MidiNotesFile {
  const notes: N[] = [];
  let t = 0;
  p.chords.forEach(([, beats, voicing], i) => {
    const [bass, ...upper] = voicing;
    // A push lands every chord but the first an eighth early; the one before it gives up that eighth.
    const early = p.rhythm === "push" && i > 0 ? 0.5 : 0;
    const late = p.rhythm === "push" && i < p.chords.length - 1 ? 0.5 : 0;
    const start = t - early;
    const span = beats + early - late;
    notes.push([+start.toFixed(3), +(span - 0.05).toFixed(3), bass!, 92]);
    if (p.rhythm === "arp") {
      const order = [...upper, ...upper.slice(1, -1).reverse()];
      hits("arp", span, p.bpm).forEach(([s, l], k) => notes.push([+(start + s).toFixed(3), +l.toFixed(3), order[k % order.length]!, k % 2 === 0 ? 84 : 70]));
    } else {
      const strum = p.rhythm === "roll" ? 0.045 : 0.012;
      for (const [s, l] of hits(p.rhythm, span, p.bpm)) {
        const accent = s % 1 === 0 ? 0 : -10;
        upper.forEach((n, j) => notes.push([+(start + s + j * strum).toFixed(3), +Math.max(0.2, l - 0.05 - j * strum).toFixed(3), n, 80 + accent - j * 3]));
      }
    }
    t += beats;
  });
  for (const [s, l, n] of p.top ?? []) notes.push([s, l, n, 90]);
  notes.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const pitches = notes.map((n) => n[2]);
  return { version: 1, bpm: p.bpm, timeSignature: [4, 4], bars: Math.ceil(t / 4), pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches), drums: false, notes };
}

/** The tempo bands the MIDI tab filters by. */
export const TEMPO_BANDS: { id: string; label: string; min: number; max: number }[] = [
  { id: "slow", label: "Under 90", min: 0, max: 89 },
  { id: "mid", label: "90–119", min: 90, max: 119 },
  { id: "fast", label: "120–139", min: 120, max: 139 },
  { id: "trap", label: "140–159", min: 140, max: 159 },
  { id: "rage", label: "160+", min: 160, max: 999 },
];
