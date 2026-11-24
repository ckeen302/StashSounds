import { limits, type MidiKind, type MidiNotesFile, type MusicalKey, type SoundId } from "@stash/contracts";
import { parseKey } from "@stash/contracts/format";

/**
 * A standard MIDI file reader for the demo, run in the browser. It does what the worker's
 * process_midi job does for a real upload: reads format 0 and 1 files, keeps the first tempo (or
 * assumes 120), turns notes into beats, and refuses files that are not MIDI, have no notes, or are
 * over limits.midi. The result is the notes file the piano roll draws (MidiNotesFile).
 */

export type MidiAnalysis = {
  notes: MidiNotesFile;
  kind: MidiKind;
  sound: SoundId;
  key: MusicalKey | null;
  tempoAssumed: boolean;
  /** Where the tempo came from, in words, for the upload screen. */
  bpmSource: "file" | "name" | "assumed";
  lengthBeats: number;
};

export class MidiError extends Error {
  constructor(
    readonly code: "not_midi" | "no_notes" | "too_many_notes" | "too_long" | "too_big" | "smpte",
    message: string,
  ) {
    super(message);
  }
}

type RawNote = { tick: number; len: number; pitch: number; vel: number; ch: number };

export function parseMidi(bytes: Uint8Array, fileName = ""): MidiAnalysis {
  if (bytes.length > limits.midi.maxBytes) throw new MidiError("too_big", "That file is over 1 MB. MIDI files are usually a few kilobytes.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 14 || tag(0) !== "MThd") throw new MidiError("not_midi", "That is not a MIDI file. Pick a .mid file exported from your DAW.");
  const headerLen = view.getUint32(4);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new MidiError("smpte", "This file uses SMPTE time. Export it with beats (PPQ) timing instead.");
  const ppq = division || 480;

  let tempo: number | null = null;
  let timeSig: [number, number] = [4, 4];
  const notes: RawNote[] = [];
  let pos = 8 + headerLen;

  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos + 4);
    const start = pos + 8;
    const end = Math.min(bytes.length, start + len);
    if (tag(pos) === "MTrk") readTrack(start, end);
    pos = start + len;
  }

  function readTrack(start: number, end: number) {
    let p = start;
    let tick = 0;
    let status = 0;
    const open = new Map<number, { tick: number; vel: number }[]>();
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const b = bytes[p++]!;
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    const close = (ch: number, pitch: number, at: number) => {
      const stack = open.get(ch * 128 + pitch);
      const on = stack?.shift();
      if (on && at > on.tick) notes.push({ tick: on.tick, len: at - on.tick, pitch, vel: on.vel, ch });
    };
    while (p < end) {
      tick += vlq();
      let b = bytes[p]!;
      if (b & 0x80) {
        p++;
        if (b < 0xf0) status = b;
      } else {
        b = status; // running status
      }
      if (b === 0xff) {
        const type = bytes[p++]!;
        const l = vlq();
        if (type === 0x51 && l === 3 && tempo === null) tempo = 60_000_000 / ((bytes[p]! << 16) | (bytes[p + 1]! << 8) | bytes[p + 2]!);
        if (type === 0x58 && l >= 2) timeSig = [bytes[p]! || 4, 2 ** (bytes[p + 1] ?? 2)];
        if (type === 0x2f) break;
        p += l;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        p += vlq();
        continue;
      }
      const hi = b & 0xf0;
      const ch = b & 0x0f;
      if (hi === 0xc0 || hi === 0xd0) {
        p += 1;
        continue;
      }
      if (hi < 0x80) break; // garbage: stop reading this track
      const d1 = bytes[p++]! & 0x7f;
      const d2 = bytes[p++]! & 0x7f;
      if (hi === 0x90 && d2 > 0) {
        const k = ch * 128 + d1;
        if (!open.has(k)) open.set(k, []);
        open.get(k)!.push({ tick, vel: d2 });
        if (notes.length > limits.midi.maxNotes) throw new MidiError("too_many_notes", `That file has more than ${limits.midi.maxNotes.toLocaleString("en")} notes.`);
      } else if (hi === 0x80 || hi === 0x90) {
        close(ch, d1, tick);
      }
    }
    // Notes never released end a beat later, the way most DAWs read them.
    for (const [k, stack] of open) for (const on of stack) notes.push({ tick: on.tick, len: ppq, pitch: k % 128, vel: on.vel, ch: Math.floor(k / 128) });
  }

  if (notes.length === 0) throw new MidiError("no_notes", "That MIDI file has no notes in it.");
  if (notes.length > limits.midi.maxNotes) throw new MidiError("too_many_notes", `That file has more than ${limits.midi.maxNotes.toLocaleString("en")} notes.`);
  notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);

  const nameBpm = bpmFromName(fileName);
  const bpmSource: MidiAnalysis["bpmSource"] = tempo ? "file" : nameBpm ? "name" : "assumed";
  const bpm = Math.round((tempo ?? nameBpm ?? 120) * 100) / 100;
  const beatsPerBar = (timeSig[0] * 4) / timeSig[1];
  const first = Math.floor(notes[0]!.tick / ppq / beatsPerBar) * beatsPerBar; // drop empty lead-in bars
  const out: MidiNotesFile["notes"] = notes.map((n) => [round(n.tick / ppq - first), round(Math.max(n.len / ppq, 1 / 64)), n.pitch, Math.max(1, n.vel)]);
  const endBeat = Math.max(...out.map(([s, l]) => s + l));
  const bars = Math.max(1, Math.ceil(endBeat / beatsPerBar - 0.02));
  const lengthBeats = bars * beatsPerBar;
  if ((lengthBeats * 60_000) / bpm > limits.midi.maxDurationMs) throw new MidiError("too_long", "That MIDI file runs over five minutes. Trim it to the part you want to share.");

  const pitches = out.map((n) => n[2]);
  const drums = notes.filter((n) => n.ch === 9).length * 2 >= notes.length;
  const kind = guessKind(out, drums);
  const key = drums ? null : (keyFromName(fileName) ?? detectKey(out));
  return {
    notes: { version: 1, bpm, timeSignature: timeSig, bars, pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches), drums, notes: out },
    kind,
    sound: SOUND_FOR[kind],
    key,
    tempoAssumed: bpmSource === "assumed",
    bpmSource,
    lengthBeats,
  };
}

export const SOUND_FOR: Record<MidiKind, SoundId> = { chords: "keys", melody: "bell", bass: "808", drums: "drums" };

const round = (x: number) => Math.round(x * 10_000) / 10_000;

function tokens(fileName: string): string[] {
  return fileName.replace(/\.[^.]+$/, "").split(/[\s_\-.()[\]]+/).filter(Boolean);
}

function bpmFromName(fileName: string): number | null {
  const m = /(\d{2,3})\s*bpm/i.exec(fileName);
  if (m) return Number(m[1]);
  for (const t of tokens(fileName)) if (/^\d{2,3}$/.test(t) && Number(t) >= 60 && Number(t) <= 200) return Number(t);
  return null;
}

function keyFromName(fileName: string): MusicalKey | null {
  for (const t of tokens(fileName)) {
    if (t.length < 2 || t.length > 6 || /bpm/i.test(t)) continue;
    const k = parseKey(t);
    if (k) return k;
  }
  return null;
}

function guessKind(notes: MidiNotesFile["notes"], drums: boolean): MidiKind {
  if (drums) return "drums";
  const starts = new Map<number, number>();
  for (const [s] of notes) {
    const q = Math.round(s * 8);
    starts.set(q, (starts.get(q) ?? 0) + 1);
  }
  const perOnset = notes.length / starts.size;
  if (perOnset >= 2.2) return "chords";
  const sorted = notes.map((n) => n[2]).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return median < 52 ? "bass" : "melody";
}

// Krumhansl-Kessler key profiles, correlated with the duration-weighted pitch classes.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectKey(notes: MidiNotesFile["notes"]): MusicalKey | null {
  const pc = Array<number>(12).fill(0);
  for (const [, len, pitch, vel] of notes) pc[pitch % 12]! += Math.min(len, 4) * (0.5 + vel / 254);
  let best: { key: MusicalKey; r: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const [mode, profile] of [["major", MAJOR], ["minor", MINOR]] as const) {
      const r = correlate(pc, profile.map((_, i) => profile[(i - root + 12) % 12]!));
      if (!best || r > best.r) best = { key: { root, mode }, r };
    }
  }
  return best && best.r > 0.3 ? best.key : null;
}

function correlate(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
