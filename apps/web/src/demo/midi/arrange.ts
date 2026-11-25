import type { MidiNotesFile } from "@stash/contracts";

/**
 * A song's arrangement as a notes file: written voicings struck in a one-bar pattern, a bass line in
 * its own one-bar pattern, swing, and an optional chord-tone top line. Each strike plays whichever
 * chord is sounding at that moment, so one bar's pattern follows mid-bar changes and pushes.
 */
export type Arrangement = {
  bpm: number;
  /** [symbol, beats, MIDI notes low to high, bass first]. */
  chords: [string, number, number[]][];
  /** Upper-voice strikes in one 4-beat bar: [start, length]. */
  hits: [number, number][];
  /** Bass strikes in one 4-beat bar: [start, length, octave offset]. */
  bass: [number, number, number][];
  /** 0 straight .. 0.6 heavy swing. */
  swing?: number;
  top?: [number, number, number][];
};

type N = [number, number, number, number];

/** The one-bar pattern each rhythm preset strikes. */
export const PRESET_HITS: Record<string, [number, number][]> = {
  held: [[0, 4]],
  roll: [[0, 4]],
  push: [[0, 3.5], [3.5, 0.5]],
  stabs: [[0, 0.5], [0.75, 0.4], [1.5, 0.4], [2.5, 0.5], [3.25, 0.4]],
  pulse: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((s): [number, number] => [s, 0.38]),
  arp: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((s): [number, number] => [s, 0.48]),
  bounce: [[0, 1.35], [1.5, 0.4], [2, 1.35], [3.5, 0.4]],
};

export function arrangeNotes(a: Arrangement, rhythm?: string): MidiNotesFile {
  const spans: { start: number; end: number; notes: number[] }[] = [];
  let once = 0;
  for (const [, beats, notes] of a.chords) {
    spans.push({ start: once, end: once + beats, notes });
    once += beats;
  }
  // Loop a short phrase to at least four bars, so it reads as a loop on the roll.
  const repeats = Math.max(1, Math.ceil(16 / once));
  const total = once * repeats;
  const at = (t: number) => {
    const local = t % once;
    const i = spans.findIndex((s) => local >= s.start - 1e-6 && local < s.end - 1e-6);
    const s = spans[i === -1 ? spans.length - 1 : i]!;
    return { ...s, end: s.end + (t - local) };
  };
  const all = [...a.hits.map((h) => h[0]), ...a.bass.map((b) => b[0])];
  const sixteenths = all.some((s) => Math.abs((s % 0.5) - 0.25) < 1e-6);
  const swing = a.swing ?? 0;
  const late = (s: number) => {
    const f = s % 1;
    if (sixteenths) return Math.abs(f - 0.25) < 1e-6 || Math.abs(f - 0.75) < 1e-6 ? swing * 0.14 : 0;
    return Math.abs(f - 0.5) < 1e-6 ? swing * 0.28 : 0;
  };
  const notes: N[] = [];
  const arp = rhythm === "arp";
  const roll = rhythm === "roll";
  let k = 0;
  for (let bar = 0; bar < total; bar += 4) {
    for (const [s, l] of a.hits) {
      const t = bar + s;
      if (t >= total) continue;
      const c = at(t);
      const start = t + late(s);
      const len = Math.max(0.1, Math.min(l, c.end - start) - 0.04);
      const upper = c.notes.slice(1);
      const accent = s === 0 ? 10 : s % 1 === 0 ? 4 : 0;
      if (arp) {
        const order = [...upper, ...upper.slice(1, -1).reverse()];
        notes.push([+start.toFixed(3), +len.toFixed(3), order[k++ % order.length]!, 72 + accent]);
        continue;
      }
      const strum = roll ? 0.045 : 0.01;
      upper.forEach((p, j) => {
        const top = j === upper.length - 1 ? 5 : 0;
        notes.push([+(start + j * strum).toFixed(3), +Math.max(0.1, len - j * strum).toFixed(3), p, Math.min(120, 68 + accent + top - j * 2)]);
      });
    }
    for (const [s, l, oct] of a.bass) {
      const t = bar + s;
      if (t >= total) continue;
      const c = at(t);
      let p = c.notes[0]! + oct;
      if (p < 28) p += 12;
      const start = t + late(s);
      const len = Math.max(0.1, Math.min(l, c.end - start) - 0.03);
      notes.push([+start.toFixed(3), +len.toFixed(3), p, s === 0 ? 100 : s % 1 === 0 ? 92 : 84]);
    }
  }
  for (let r = 0; r < repeats; r++) for (const [s, l, p] of a.top ?? []) notes.push([+(s + r * once).toFixed(3), l, p, 88]);
  notes.sort((x, y) => x[0] - y[0] || x[2] - y[2]);
  const pitches = notes.map((n) => n[2]);
  return { version: 1, bpm: a.bpm, timeSignature: [4, 4], bars: Math.ceil(total / 4), pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches), drums: false, notes };
}
