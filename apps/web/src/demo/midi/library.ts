import type { MidiNotesFile } from "@stash/contracts";

/**
 * More demo MIDI: original patterns written for the demo across the styles Stash is for (trap,
 * boom bap, plugg, drill, rage, R&B, lo-fi, Jersey club, phonk, West Coast). None is a copy of a
 * song. A small pattern language keeps them readable:
 *   - chords: one chord per bar, voiced explicitly, hit on a rhythm of [beat, length] pairs;
 *   - melodies: "C5:1 D#5:.5 -:.5" (note:beats, "-" is a rest);
 *   - drums: one 16-step string per sound and bar, "X" accent, "x" hit, "o" ghost, "." rest.
 */

export type N = [number, number, number, number];

const PC: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

/** "C4" is 60. */
export function p(name: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return PC[m[1]!]! + (Number(m[2]) + 1) * 12;
}

/** A melody line from "C5:1 D#5:.5 -:.5", starting at `at` beats. */
export function line(src: string, at = 0, vel = 96): N[] {
  const out: N[] = [];
  let t = at;
  for (const tok of src.trim().split(/\s+/)) {
    const [n, l] = tok.split(":");
    const len = Number(l ?? 1);
    if (n !== "-") {
      const accent = n!.endsWith("!");
      out.push([t, len * 0.95, p(n!.replace("!", "")), accent ? Math.min(127, vel + 18) : t % 1 === 0 ? vel : vel - 12]);
    }
    t += len;
  }
  return out;
}

/** Chords: one voicing (note names) per bar, struck on `rhythm` ([beat, length] within the bar). */
export function chords(bars: string[][], rhythm: [number, number][], vel = 80, bpb = 4): N[] {
  const out: N[] = [];
  bars.forEach((voicing, b) => {
    for (const [at, len] of rhythm) {
      voicing.forEach((n, i) => out.push([b * bpb + at + i * 0.012, len, p(n), vel - i * 3 - (at % 1 ? 10 : 0)]));
    }
  });
  return out;
}

/** Drums: per bar, a map of GM note to a 16-step string (or 12 for triplet bars). */
export function drums(bars: Record<number, string>[], bpb = 4): N[] {
  const out: N[] = [];
  bars.forEach((bar, b) => {
    for (const [note, steps] of Object.entries(bar)) {
      const n = steps.replace(/\s/g, "");
      const step = bpb / n.length;
      [...n].forEach((c, i) => {
        if (c === ".") return;
        const v = c === "X" ? 122 : c === "x" ? 100 : c === "o" ? 62 : 84;
        out.push([b * bpb + i * step, Math.min(step, 0.25), Number(note), v]);
      });
    }
  });
  return out;
}

/** Swing: push every off-sixteenth later by `amount` of a sixteenth. */
export function swing(notes: N[], amount = 0.55): N[] {
  return notes.map(([s, l, pitch, v]) => {
    const six = s * 4;
    const odd = Math.abs(six - Math.round(six)) < 1e-6 && Math.round(six) % 2 === 1;
    return [odd ? s + (amount - 0.5) * 0.5 : s, l, pitch, v];
  });
}

export function humanize(notes: N[], seed: number, amount = 0.012): N[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  return notes.map(([st, len, pitch, v]) => [Math.max(0, +(st + (st === 0 ? 0 : rnd() * amount)).toFixed(4)), len, pitch, Math.max(1, Math.min(127, Math.round(v + rnd() * 7)))]);
}

export function file(notes: N[], bpm: number, bars: number, drumsFile = false, ts: [number, number] = [4, 4]): MidiNotesFile {
  const sorted = [...notes].sort((a, b) => a[0] - b[0] || a[2] - b[2]).map(([s, l, pitch, v]): N => [+s.toFixed(4), +Math.max(l, 1 / 32).toFixed(4), pitch, v]);
  const pitches = sorted.map((n) => n[2]);
  return { version: 1, bpm, timeSignature: ts, bars, pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches), drums: drumsFile, notes: sorted };
}

const rep = <T>(xs: T[], times: number): T[] => Array.from({ length: times }, () => xs).flat();
const shift = (notes: N[], beats: number): N[] => notes.map(([s, l, pi, v]) => [s + beats, l, pi, v]);

// ---------------------------------------------------------------------------------------------

/** Dark trap piano, C minor, 140: a falling minor line over octave roots. */
export function darkTrapPiano(): MidiNotesFile {
  const mel = line("Eb5:.5 D5:.5 C5:1 G4:.5 Ab4:.5 G4:1 Eb5:.5 D5:.5 C5:.5 D5:.5 Eb5:1 F5:.5 G5:.5 Ab5:1.5 G5:.5 F5:1 Eb5:1 D5:.5 C5:.5 B4:1 C5:2 -:2", 0, 92);
  const bass = [...line("C3:4 Ab2:4 F2:4 G2:4", 0, 84), ...line("C2:4 Ab1:4 F1:4 G1:4", 0, 70)];
  const pads = chords([["G3", "C4", "Eb4"], ["Ab3", "C4", "Eb4"], ["F3", "Ab3", "C4"], ["G3", "B3", "D4"]], [[0, 3.8]], 58);
  return file(humanize([...mel, ...bass, ...pads], 3), 140, 4);
}

/** Boom bap Rhodes, D minor, 90, swung: Dm9, G13, Cmaj9, A7#9. */
export function boomBapRhodes(): MidiNotesFile {
  const v = [["D3", "F4", "A4", "C5", "E5"], ["G2", "F4", "B4", "E5"], ["C3", "E4", "G4", "B4", "D5"], ["A2", "G4", "C#5", "C5"]];
  const hits = chords(v, [[0, 1.4], [1.75, 0.4], [2.5, 1.3]], 78);
  return file(humanize(swing(hits, 0.6), 9, 0.02), 90, 4);
}

/** Pluggnb chords, Bb major, 150: Ebmaj7, Dm7, Cm7, Fsus, airy and wide. */
export function pluggChords(): MidiNotesFile {
  const v = [["Eb3", "G4", "Bb4", "D5"], ["D3", "F4", "A4", "C5"], ["C3", "Eb4", "G4", "Bb4"], ["F3", "Bb4", "C5", "Eb5"]];
  const hits = chords([...v, ...v], [[0, 3.9]], 70);
  const top = line("-:3 D6:.5 C6:.5 -:3 C6:.5 Bb5:.5 -:3 Bb5:.5 G5:.5 -:3 A5:1 -:3 D6:.5 C6:.5 -:3 C6:.5 Bb5:.5 -:3 Bb5:.5 G5:.5 -:2 F5:1 Eb5:.5 F5:.5", 0, 80);
  return file(humanize([...hits, ...top], 17), 150, 8);
}

/** Rage lead, F minor, 160: a stabbing sixteenth figure, octave-up answer. */
export function rageLead(): MidiNotesFile {
  const figA = "F5:.25 F5:.25 -:.25 Ab5:.25 F5:.25 -:.25 C6:.5 Bb5:.25 Ab5:.25 -:.25 F5:.25 Eb5:.5 F5:.5";
  const figB = "F5:.25 F5:.25 -:.25 Ab5:.25 F5:.25 -:.25 C6:.5 Db6:.25 C6:.25 -:.25 Bb5:.25 Ab5:.5 G5:.5";
  const a = line(figA, 0, 104);
  const b = line(figB, 4, 104);
  const hi = (ns: N[]): N[] => ns.map(([s, l, pi, v]) => [s, l, pi + 12, v - 30]);
  const notes = [...a, ...b, ...shift(a, 8), ...shift(hi(b), 8), ...shift(b, 8)];
  return file(notes, 160, 4);
}

/** Boom bap drums, 90, swung, with ghost snares. */
export function boomBapDrums(): MidiNotesFile {
  const A = { 36: "X.........x.....", 38: "....X.......X...", 42: "x.x.x.x.x.x.x.x." };
  const B = { 36: "X......x..x.....", 38: "....X..o....X..o", 42: "x.x.x.x.x.x.xxx." };
  return file(humanize(swing(drums([A, B, A, { ...B, 46: "..............x." }]), 0.62), 5, 0.008), 90, 4, true);
}

/** Trap drums, 140: half-time snare, rolling hats with a triplet run and a 32nd roll. */
export function trapDrums(): MidiNotesFile {
  const base = { 36: "X......x..X.....", 39: "........X.......", 38: "........X.......", 42: "x.x.x.x.x.x.x.x." };
  const notes = drums([base, { ...base, 36: "X.....x...X..x.." }, base, { ...base, 36: "X......x..X...x.", 42: "x.x.x.x.x.x....." }]);
  notes.push(...[0, 1, 2, 3, 4, 5].map((i): N => [4 + 2 + i / 6, 1 / 6, 42, 70 + i * 6]));
  notes.push(...[0, 1, 2, 3, 4, 5, 6, 7].map((i): N => [12 + 3 + i / 8, 1 / 8, 42, 60 + i * 7]));
  return file(humanize(notes, 29, 0.004), 140, 4, true);
}

/** Jersey club drums, 140: the bed-squeak kick pattern in fives, claps on the ands. */
export function jerseyClub(): MidiNotesFile {
  const bar = { 36: "X..x..x.X.x.x...", 39: "....x.......x...", 42: "..x...x...x...x." };
  const bar2 = { 36: "X..x..x.X.x.x.xx", 39: "....x.......x..x", 42: "..x...x...x...x." };
  return file(drums([bar, bar2, bar, { ...bar2, 49: "X..............." }]), 140, 4, true);
}

/** Phonk cowbell melody, Bb minor, 130: the 808-cowbell line, played on bell. */
export function phonkBell(): MidiNotesFile {
  const a = line("Bb5:.5 Bb5:.25 Db6:.25 -:.25 Bb5:.25 Ab5:.5 F5:.5 Ab5:.5 Bb5:.5 F5:.5", 0, 100);
  const b = line("Bb5:.5 Bb5:.25 Db6:.25 -:.25 Bb5:.25 Ab5:.5 F5:.5 Eb5:.5 F5:.5 Db5:.5", 4, 100);
  return file([...a, ...b, ...shift(a, 8), ...shift(b, 8)], 130, 4);
}

/** UK drill strings, C sharp minor, 142: ominous half-step answers. */
export function drillStrings(): MidiNotesFile {
  const top = line("G#4:1.5 A4:.5 G#4:1 E4:1 F#4:1.5 G#4:.5 F#4:1 D#4:1 G#4:1.5 A4:.5 G#4:1 B4:1 C#5:2 B4:1 A4:1", 0, 90);
  const low = chords([["C#3", "G#3"], ["B2", "F#3"], ["A2", "E3"], ["G#2", "D#3"]], [[0, 3.9]], 70);
  return file(humanize([...top, ...low], 41), 142, 4);
}

/** Late night R&B, G flat major, 68: Gbmaj9, Fm7, Ebm9, Abadd9. */
export function rnbChords(): MidiNotesFile {
  const v = [["Gb2", "F4", "Ab4", "Bb4", "Db5"], ["F2", "Eb4", "Ab4", "C5"], ["Eb2", "Db4", "F4", "Gb4", "Bb4"], ["Ab2", "Eb4", "Ab4", "Bb4", "C5"]];
  const hits = chords([...v, ...v], [[0, 2.8], [3, 0.9]], 72);
  const top = line("-:2 Db6:.5 Bb5:.5 Ab5:1 -:2.5 C6:.5 Ab5:1 -:2 Bb5:.5 Gb5:.5 F5:1 -:3 Eb5:1", 16, 74);
  return file(humanize([...hits, ...top], 51, 0.02), 68, 8);
}

/** Lo-fi chords, A minor, 80: Am9, Dm9, Gmaj7, Cmaj7, lazy and swung. */
export function lofiChords(): MidiNotesFile {
  const v = [["A2", "G3", "C4", "E4", "B4"], ["D3", "C4", "F4", "A4", "E5"], ["G2", "F#3", "B3", "D4", "A4"], ["C3", "B3", "E4", "G4", "D5"]];
  const hits = chords(v, [[0, 1.8], [2.25, 1.6]], 64);
  return file(humanize(swing(hits, 0.62), 61, 0.03), 80, 4);
}

/** West Coast whistle lead, G minor, 96: a slow portamento-style line with long tails. */
export function westCoastLead(): MidiNotesFile {
  const notes = line("D6:1.5 C6:.5 Bb5:1 A5:1 G5:3 -:1 Bb5:1 C6:1 D6:1 F6:1 D6:3 -:1", 0, 88);
  const bass = line("G2:.75 -:.25 G2:.5 Bb2:.5 C3:1 D3:1 Eb3:.75 -:.25 Eb3:.5 D3:.5 C3:1 Bb2:1 G2:.75 -:.25 G2:.5 Bb2:.5 C3:1 D3:1 F2:.75 -:.25 F2:.5 A2:.5 C3:1 D3:1", 0, 96);
  return file([...notes, ...shift(notes, 8), ...bass], 96, 4);
}

/** Melodic trap guitar-style arp, E minor, 150: Em, C, G, D broken into eighths. */
export function trapArp(): MidiNotesFile {
  const arp = (ns: string[]) => rep(ns, 2).flatMap((n, i): N[] => [[i * 0.5, 0.45, p(n), i % 4 === 0 ? 96 : 78]]);
  const bars = [["E3", "B3", "E4", "G4"], ["C3", "G3", "C4", "E4"], ["G2", "D3", "G3", "B3"], ["D3", "A3", "D4", "F#4"]];
  const notes = bars.flatMap((b, i) => shift(arp(b), i * 4));
  return file(humanize(notes, 71, 0.01), 150, 4);
}

/** Memphis-style 808 bass, B flat minor, 130, for the phonk bell. */
export function phonkBass(): MidiNotesFile {
  return file(line("Bb1:1.5 Bb1:.5 -:.5 Db2:.5 Bb1:1 Gb1:1.5 Gb1:.5 -:.5 Ab1:.5 F1:1 Bb1:1.5 Bb1:.5 -:.5 Db2:.5 Bb1:1 Ab1:1 Gb1:1 F1:2", 0, 110), 130, 4);
}
