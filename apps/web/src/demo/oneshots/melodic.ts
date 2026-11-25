import { HOUSE, type Producer } from "../data";
import { VIEWER } from "../midi/catalog";
import { MidiPlayer, type Timbre } from "../midi/synth";
import { saveFiles, wav, type SaveOutcome } from "../save";
import { claimPlay, decode, getFile, isCurrentPlay, playBuffer } from "../kits/store";
import { loadMine, type Stored } from "./store";

/**
 * Melodic one-shots: single notes and chords from keys, bells, plucks, pads, leads, guitars, 808s
 * and the rest, each in every key, so a producer can lay a melody or a chord stab without opening
 * a heavy synth. Every sound is rendered in the browser from the demo's own voices; the viewer's
 * own posted hits sit beside them.
 */

export type InstrumentId = "808" | "bass" | "piano" | "keys" | "bells" | "pluck" | "pad" | "lead" | "strings" | "choir" | "flute" | "organ" | "guitar" | "acoustic";

type Quality = { id: string; suffix: string; steps: number[]; name: string };
const MINOR: Quality = { id: "m", suffix: "m", steps: [0, 3, 7], name: "minor" };
const MAJOR: Quality = { id: "maj", suffix: "", steps: [0, 4, 7], name: "major" };
const MIN7: Quality = { id: "m7", suffix: "m7", steps: [0, 3, 7, 10], name: "minor 7" };
const MAJ7: Quality = { id: "maj7", suffix: "maj7", steps: [0, 4, 7, 11], name: "major 7" };
const MIN9: Quality = { id: "m9", suffix: "m9", steps: [0, 3, 7, 10, 14], name: "minor 9" };

export type Instrument = {
  id: InstrumentId;
  label: string;
  timbre: Timbre;
  /** The sound's name, as a pack would call it. */
  sound: string;
  /** The octave its notes sit in (C4 is middle C). */
  octave: number;
  /** Seconds the note is held before its release. */
  hold: number;
  /** Seconds after the hold the render keeps, for the tail. */
  tail: number;
  notes: boolean;
  chords: Quality[];
};

export const INSTRUMENTS: Instrument[] = [
  { id: "keys", label: "Keys", timbre: "keys", sound: "Dusty Rhodes", octave: 4, hold: 1.2, tail: 1.2, notes: true, chords: [MIN7, MAJ7, MIN9] },
  { id: "piano", label: "Piano", timbre: "piano", sound: "Felt Piano", octave: 4, hold: 1.4, tail: 1.2, notes: true, chords: [MINOR, MAJ7] },
  { id: "bells", label: "Bells", timbre: "bell", sound: "Music Box", octave: 5, hold: 0.6, tail: 1.8, notes: true, chords: [MINOR] },
  { id: "pluck", label: "Plucks", timbre: "pluck", sound: "Glass Pluck", octave: 4, hold: 0.3, tail: 0.9, notes: true, chords: [MINOR] },
  { id: "pad", label: "Pads", timbre: "pad", sound: "Night Pad", octave: 3, hold: 2.4, tail: 1.6, notes: false, chords: [MIN7, MAJ7] },
  { id: "lead", label: "Leads", timbre: "synth", sound: "Saw Lead", octave: 4, hold: 0.9, tail: 0.6, notes: true, chords: [] },
  { id: "808", label: "808s", timbre: "808", sound: "Long 808", octave: 2, hold: 1.4, tail: 0.6, notes: true, chords: [] },
  { id: "bass", label: "Bass", timbre: "bass", sound: "Round Bass", octave: 2, hold: 0.8, tail: 0.4, notes: true, chords: [] },
  { id: "strings", label: "Strings", timbre: "strings", sound: "Dark Strings", octave: 3, hold: 2, tail: 1.2, notes: true, chords: [MINOR, MIN7] },
  { id: "choir", label: "Choir", timbre: "choir", sound: "Ahh Choir", octave: 4, hold: 1.8, tail: 1.2, notes: true, chords: [MINOR] },
  { id: "guitar", label: "Guitar", timbre: "guitar", sound: "Clean Guitar", octave: 3, hold: 1.2, tail: 1, notes: true, chords: [MINOR, MAJOR] },
  { id: "acoustic", label: "Acoustic", timbre: "acoustic", sound: "Nylon Guitar", octave: 3, hold: 1.2, tail: 1, notes: true, chords: [MINOR, MIN7] },
  { id: "organ", label: "Organ", timbre: "organ", sound: "Gospel Organ", octave: 3, hold: 1.6, tail: 0.6, notes: false, chords: [MAJOR, MIN7] },
  { id: "flute", label: "Flute", timbre: "flute", sound: "Breathy Flute", octave: 5, hold: 1, tail: 0.6, notes: true, chords: [] },
];

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type Root = (typeof NOTE_NAMES)[number];

export type MelodicShot = {
  id: string;
  name: string;
  instrument: InstrumentId;
  kind: "note" | "chord";
  /** The root, 0 for C to 11 for B. */
  root: number;
  /** "C#3" for a note, "C#m7" for a chord. */
  label: string;
  /** What the label means, for screen readers and search: "C sharp minor 7". */
  spoken: string;
  pitches: number[];
  durationMs: number;
  owner: Producer;
  /** A posted hit: its audio is in this browser's storage. */
  posted?: { fileKey: string; ext: string };
  mine?: boolean;
};

function spokenRoot(r: number): string {
  const n = NOTE_NAMES[r]!;
  return n.length > 1 ? `${n[0]} sharp` : n;
}

function build(): MelodicShot[] {
  const out: MelodicShot[] = [];
  for (const inst of INSTRUMENTS) {
    const ms = Math.round((inst.hold + inst.tail) * 1000);
    for (let r = 0; r < 12; r++) {
      const base = 12 * (inst.octave + 1) + r;
      const name = NOTE_NAMES[r]!;
      if (inst.notes) {
        // Notes past B wrap into the octave, so the label's octave is the real one.
        const label = `${name}${inst.octave}`;
        out.push({ id: `mel-${inst.id}-${r}`, name: `${inst.sound} ${label}`, instrument: inst.id, kind: "note", root: r, label, spoken: `${spokenRoot(r)} ${inst.octave}`, pitches: [base], durationMs: ms, owner: HOUSE });
      }
      for (const q of inst.chords) {
        const label = `${name}${q.suffix}`;
        out.push({ id: `mel-${inst.id}-${r}-${q.id}`, name: `${inst.sound} ${label}`, instrument: inst.id, kind: "chord", root: r, label, spoken: `${spokenRoot(r)} ${q.name}`, pitches: q.steps.map((s) => base + s), durationMs: ms, owner: HOUSE });
      }
    }
  }
  return out;
}

export const MELODIC: MelodicShot[] = build();

export function instrumentOf(id: InstrumentId): Instrument {
  return INSTRUMENTS.find((i) => i.id === id)!;
}

/** Reads an instrument from a posted file's name ("rhodes", "bell", "pad"...). Keys when unclear. */
export function guessInstrument(fileName: string): InstrumentId {
  const n = fileName.toLowerCase();
  const tests: [RegExp, InstrumentId][] = [
    [/808/, "808"],
    [/bass|sub/, "bass"],
    [/bell|glock|music ?box|celest|chime/, "bells"],
    [/pluck|harp|kalimba/, "pluck"],
    [/pad|atmos|ambient/, "pad"],
    [/lead|saw|synth/, "lead"],
    [/string|violin|cello/, "strings"],
    [/choir|vox|vocal|ahh|ooh/, "choir"],
    [/flute|whistle/, "flute"],
    [/organ/, "organ"],
    [/acoustic|nylon/, "acoustic"],
    [/guitar|gtr/, "guitar"],
    [/piano/, "piano"],
  ];
  return tests.find(([re]) => re.test(n))?.[1] ?? "keys";
}

/** Reads a note or chord from a posted file's name: "Bell_F#4", "Keys Cm7". */
export function guessLabel(fileName: string): { label: string; root: number; kind: "note" | "chord" } | null {
  const m = /(?:^|[\s_\-(])([A-G])(#|b|s(?=\d|m|_|\s|$))?(m(?:aj)?\d*|min\d*|maj\d*|\d)?(?=$|[\s_\-).])/.exec(fileName.replace(/\.\w+$/, ""));
  if (!m) return null;
  let root = "C D EF G A B".indexOf(m[1]!);
  if (m[2] === "#" || m[2] === "s") root = (root + 1) % 12;
  if (m[2] === "b") root = (root + 11) % 12;
  const rest = m[3] ?? "";
  const kind = /^\d$/.test(rest) ? "note" : rest ? "chord" : "note";
  return { label: `${NOTE_NAMES[root]}${rest.replace(/^min/, "m")}`, root, kind };
}

/** The viewer's own posted hits, as melodic one-shots. */
export function mineAsMelodic(stored: Stored[] = loadMine()): MelodicShot[] {
  return stored.map((s) => {
    const g = guessLabel(s.name);
    return {
      id: s.id,
      name: s.name,
      instrument: guessInstrument(s.name),
      kind: g?.kind ?? "note",
      root: g?.root ?? -1,
      label: g?.label ?? "",
      spoken: g?.label ?? "",
      pitches: [],
      durationMs: s.durationMs,
      owner: VIEWER,
      posted: { fileKey: s.fileKey, ext: s.ext },
      mine: true,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Audio

const buffers = new Map<string, Promise<AudioBuffer | null>>();

export function bufferOf(s: MelodicShot): Promise<AudioBuffer | null> {
  let p = buffers.get(s.id);
  if (!p) {
    if (s.posted) {
      p = getFile(s.posted.fileKey)
        .then((d) => (d ? decode(d) : null))
        .catch(() => null);
    } else {
      const inst = instrumentOf(s.instrument);
      p = MidiPlayer.renderNotes(inst.timbre, s.pitches, inst.hold, inst.hold + inst.tail).catch(() => null);
    }
    buffers.set(s.id, p);
  }
  return p;
}

export async function playShot(s: MelodicShot): Promise<void> {
  const mine = claimPlay();
  const b = await bufferOf(s);
  // A newer tap or arrow key won while this one was rendering: don't play it late.
  if (b && isCurrentPlay(mine)) playBuffer(b);
}

/** Renders a few sounds ahead of time so the next tap or arrow key plays without a wait. */
export function warmShots(shots: MelodicShot[]) {
  for (const s of shots) void bufferOf(s);
}

const peakCache = new Map<string, number[]>();

export async function peaksOf(s: MelodicShot, n = 40): Promise<number[]> {
  const hit = peakCache.get(s.id);
  if (hit) return hit;
  const b = await bufferOf(s);
  if (!b) return [];
  const d = b.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(d[j]!));
    out.push(m);
  }
  const top = Math.max(...out, 1e-6);
  const norm = out.map((v) => v / top);
  peakCache.set(s.id, norm);
  return norm;
}

export function fileName(s: MelodicShot): string {
  const base = s.name.replace(/#/g, "sharp").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "one-shot";
  return `${base}.${s.posted?.ext ?? "wav"}`;
}

async function fileOf(s: MelodicShot): Promise<Blob | null> {
  if (s.posted) {
    const d = await getFile(s.posted.fileKey);
    return d ? new Blob([d]) : null;
  }
  const b = await bufferOf(s);
  return b ? wav(b) : null;
}

/** Saves one shot as its file, or several as one zip. "empty" when none has audio here. */
export async function saveMelodic(list: MelodicShot[], zipName: string, max = 60): Promise<{ outcome: SaveOutcome | "empty"; names: string[] }> {
  const files: { name: string; data: Blob }[] = [];
  const used = new Set<string>();
  for (const s of list.slice(0, max)) {
    const data = await fileOf(s);
    if (!data) continue;
    let name = fileName(s);
    for (let i = 2; used.has(name); i++) name = fileName(s).replace(/(\.\w+)$/, `_${i}$1`);
    used.add(name);
    files.push({ name, data });
  }
  if (files.length === 0) return { outcome: "empty", names: [] };
  return { outcome: await saveFiles(zipName, files, { title: list.length === 1 ? zipName.replace(/_/g, " ") : `${zipName.replace(/_/g, " ")} (${list.length} sounds)`, kind: list.length === 1 ? "One-shot" : "One-shot pack", by: "Stash" }), names: files.map((f) => f.name) };
}
