import type { MidiNotesFile, MusicalKey } from "@stash/contracts";
import { parseKey } from "@stash/contracts/format";
import type { Producer } from "../data";
import raw from "./song-chords.json" with { type: "json" };
import { BATCHES } from "./song-batches/index";
import { arrangeNotes, PRESET_HITS, type Arrangement } from "./arrange";
import type { Timbre } from "./synth";

/**
 * Chord progressions of popular songs, as MIDI: researched chord symbols (song-chords.json, each
 * with the page it came from) voiced here into playable chords at the song's key and tempo.
 * Chords only: no melodies, no note-for-note transcription of a recording.
 */

export type SongChords = {
  song: string;
  artist: string;
  producer: string | null;
  key: string;
  bpm: number;
  chords: [string, number][];
  section?: string;
  chordSource: { label: string; url: string };
  keyBpmSource?: { label: string; url: string } | null;
  notes?: string;
  /** "verified" when each chord's length was read from a chart with timing; otherwise one bar per chord is assumed. */
  rhythm?: "verified";
  /** What plays the chords on the record, with where that is said. */
  instrument?: { name: string; quote: string; source: { label: string; url: string } };
  /** From the song batches: the record's arrangement, played on the instrument closest to the record. */
  arrangement?: Arrangement & { rhythm?: string };
  timbre?: Timbre;
  /** What carries the chords on the record, by ear (batch songs); `instrument` is the sourced version. */
  heard?: string;
  album?: string;
  year?: number;
  genre?: string;
  cover?: { album: string; albumUrl: string; artwork: string } | null;
};

/** A batch song (song-batches/*.json, audited by scripts/check-song-batches.py) as a chord chart with its arrangement. */
type BatchSong = {
  song: string;
  artist: string;
  producer: string | null;
  album: string;
  year: number;
  genre: string;
  key: string;
  bpm: number;
  section: string;
  chordSource: { label: string; url: string };
  keyBpmSource: { label: string; url: string } | null;
  timbre: Timbre;
  instrument: string;
  cover: SongChords["cover"];
  swing?: number;
  chords: [string, number, number[]][];
  hits?: [number, number][];
  rhythm?: string;
  bass: [number, number, number][];
  top?: [number, number, number][];
  notes: string;
};

function fromBatch(b: BatchSong): SongChords {
  return {
    song: b.song,
    artist: b.artist,
    producer: b.producer,
    key: b.key,
    bpm: b.bpm,
    chords: b.chords.map(([c, beats]) => [c, beats]),
    section: b.section,
    chordSource: b.chordSource,
    keyBpmSource: b.keyBpmSource,
    notes: b.notes,
    arrangement: { bpm: b.bpm, chords: b.chords, hits: b.hits ?? PRESET_HITS[b.rhythm ?? "held"] ?? PRESET_HITS.held!, bass: b.bass, swing: b.swing, top: b.top, rhythm: b.hits ? undefined : b.rhythm },
    timbre: b.timbre,
    heard: b.instrument,
    album: b.album,
    year: b.year,
    genre: b.genre,
    cover: b.cover,
  };
}

export const BATCH_SONGS: SongChords[] = (BATCHES.flat() as BatchSong[]).map(fromBatch);

export const SONG_CHORDS: SongChords[] = [...(raw as unknown as SongChords[]), ...BATCH_SONGS];

export const CHORDS_OWNER: Producer = { id: "00000000-0000-4000-8000-0000000000c0", handle: "stash_chords", displayName: "Stash chord charts", followers: 0 };

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Intervals above the root for the chord qualities that charts use. */
const QUALITY: [RegExp, number[]][] = [
  [/^(m7b5|ø7?|min7b5|-7b5)$/, [0, 3, 6, 10]],
  [/^(dim7|°7|o7)$/, [0, 3, 6, 9]],
  [/^(dim|°|o)$/, [0, 3, 6]],
  [/^(aug|\+)$/, [0, 4, 8]],
  [/^(m|min|-)(maj7|M7|Δ7?)$/, [0, 3, 7, 11]],
  [/^(maj13|M13|Δ13)$/, [0, 4, 7, 11, 14, 21]],
  [/^(maj9|M9|Δ9)$/, [0, 4, 7, 11, 14]],
  [/^(maj7|M7|Δ7?|maj)$/, [0, 4, 7, 11]],
  [/^(m|min|-)13$/, [0, 3, 7, 10, 14, 21]],
  [/^(m|min|-)11$/, [0, 3, 7, 10, 14, 17]],
  [/^(m|min|-)9$/, [0, 3, 7, 10, 14]],
  [/^(m|min|-)7$/, [0, 3, 7, 10]],
  [/^(m|min|-)6$/, [0, 3, 7, 9]],
  [/^(m|min|-)add9$/, [0, 3, 7, 14]],
  [/^(m|min|-)$/, [0, 3, 7]],
  [/^(6\/9|69|6add9)$/, [0, 4, 7, 9, 14]],
  [/^(m|min|-)(6\/9|69)$/, [0, 3, 7, 9, 14]],
  [/^13$/, [0, 4, 7, 10, 14, 21]],
  [/^11$/, [0, 4, 7, 10, 14, 17]],
  [/^9$/, [0, 4, 7, 10, 14]],
  [/^9sus4?$/, [0, 5, 7, 10, 14]],
  [/^7sus4?$/, [0, 5, 7, 10]],
  [/^7sus2$/, [0, 2, 7, 10]],
  [/^add11$/, [0, 4, 7, 17]],
  [/^(m|min|-)add11$/, [0, 3, 7, 17]],
  [/^(m|min|-)7add11$/, [0, 3, 7, 10, 17]],
  [/^(maj7|M7)add11$|^maj7#11$/, [0, 4, 7, 11, 18]],
  [/^7$/, [0, 4, 7, 10]],
  [/^6$/, [0, 4, 7, 9]],
  [/^add9$|^add2$/, [0, 4, 7, 14]],
  [/^sus2$/, [0, 2, 7]],
  [/^6sus2$/, [0, 2, 7, 9]],
  [/^(maj7|M7)sus2$/, [0, 2, 7, 11]],
  [/^(maj7|M7)sus4?$/, [0, 5, 7, 11]],
  [/^6sus4?$/, [0, 5, 7, 9]],
  [/^sus4?$/, [0, 5, 7]],
  [/^5$/, [0, 7]],
  [/^$/, [0, 4, 7]],
];

export type ParsedChord = { root: number; tones: number[]; bass: number };

function pitchClass(name: string): number | null {
  const m = /^([A-G])([#b♯♭]*)$/.exec(name);
  if (!m) return null;
  let pc = NOTE[m[1]!]!;
  for (const a of m[2]!) pc += a === "#" || a === "♯" ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

/** "C#m7", "Bbmaj7/D", "F#m7b5", "Esus4". Returns null for anything it cannot read. */
export function parseChord(symbol: string): ParsedChord | null {
  const s = symbol.trim().replace(/\s+/g, "");
  const m = /^([A-G][#b♯♭]?)((?:[^/]|\/9)*)(?:\/([A-G][#b♯♭]?))?$/.exec(s);
  if (!m) return null;
  const root = pitchClass(m[1]!);
  if (root === null) return null;
  // Drop extensions in parentheses and trailing alterations the voicing does not need: "7(b9)", "m9(11)".
  const quality = m[2]!.replace(/\(.*\)$/, "");
  const plain = quality.replace(/(b9|#9|#11|b13|#5|b5)+$/, "");
  const found = [quality, plain, plain.replace(/\d+$/, "")].map((q) => QUALITY.find(([re]) => re.test(q))).find(Boolean);
  if (!found) return null;
  const bass = m[3] ? pitchClass(m[3]) : root;
  if (bass === null) return null;
  return { root, tones: found[1], bass };
}

/** Voices each chord near the previous one (smallest total movement), between E3 and E5, with the bass under it. */
export function voice(chords: ParsedChord[]): { upper: number[]; bass: number }[] {
  let prev: number[] | null = null;
  return chords.map((c) => {
    const pcs = c.tones.map((i) => (c.root + i) % 12);
    const unique = [...new Set(pcs)].slice(0, 5);
    // Candidate voicings: every inversion, stacked upward from a start note in the middle register.
    let best: number[] = [];
    let bestCost = Infinity;
    for (let inv = 0; inv < unique.length; inv++) {
      const order = [...unique.slice(inv), ...unique.slice(0, inv)];
      for (const startOct of [4, 5]) {
        const out: number[] = [];
        let last = 12 * startOct + order[0]! - 12;
        for (const pc of order) {
          let n = Math.floor(last / 12) * 12 + pc;
          while (n <= last && out.length > 0) n += 12;
          out.push(n);
          last = n;
        }
        if (out[0]! < 52 || out.at(-1)! > 79) continue;
        const centre = out.reduce((a, b) => a + b, 0) / out.length;
        const cost = prev ? out.reduce((sum, n, i) => sum + Math.abs(n - (prev![Math.min(i, prev!.length - 1)] ?? n)), 0) : Math.abs(centre - 62) * 2;
        if (cost < bestCost) {
          bestCost = cost;
          best = out;
        }
      }
    }
    if (best.length === 0) best = unique.map((pc) => 60 + pc);
    prev = best;
    return { upper: best, bass: 36 + ((c.bass - 36 + 120) % 12) };
  });
}

/** The progression as a notes file: held chords with a bass note, looped to at least four bars. */
export function songNotes(s: SongChords): MidiNotesFile | null {
  if (s.arrangement) return arrangeNotes(s.arrangement, s.arrangement.rhythm);
  const parsed = s.chords.map(([sym]) => parseChord(sym));
  if (parsed.some((p) => p === null) || parsed.length === 0) return null;
  const voiced = voice(parsed as ParsedChord[]);
  const once = s.chords.reduce((n, [, beats]) => n + beats, 0);
  if (once <= 0 || once % 1 !== 0) return null;
  const repeats = Math.max(1, Math.ceil(16 / once));
  const notes: [number, number, number, number][] = [];
  let t = 0;
  for (let r = 0; r < repeats; r++) {
    s.chords.forEach(([, beats], i) => {
      const v = voiced[i]!;
      const len = Math.max(0.25, beats - 0.05);
      v.upper.forEach((p, j) => notes.push([+(t + j * 0.012).toFixed(3), len, p, 76 - j * 3]));
      notes.push([t, len, v.bass, 88]);
      t += beats;
    });
  }
  const pitches = notes.map((n) => n[2]);
  notes.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  return { version: 1, bpm: s.bpm, timeSignature: [4, 4], bars: Math.ceil(t / 4), pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches), drums: false, notes };
}

export function songKey(s: SongChords): MusicalKey | null {
  // Modes read as the major or minor key they sit closest to: B Dorian files under B minor.
  const k = s.key
    .replace(/\b(dorian|phrygian|aeolian|locrian|harmonic minor|melodic minor)\b/i, "minor")
    .replace(/\b(mixolydian|lydian|ionian)\b/i, "major")
    .replace(/\s*\(.*\)$/, "");
  return parseKey(k.replace(/\s+/g, ""));
}

const MAJOR_DEG = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];
const MINOR_DEG = ["I", "bII", "II", "III", "#III", "IV", "bV", "V", "VI", "#VI", "VII", "#VII"];

/**
 * The song's progression as roman numerals in its own key ("i–VI–III–VII"), so songs that share a
 * progression group together whatever key they are in. Inversions and extensions are dropped, a
 * repeated cycle counts once, and at most four chords are kept. Null when the key or a chord can't be read.
 */
export function progressionOf(s: SongChords): { label: string; minor: boolean } | null {
  const km = /^([A-G][#b♯♭]?)\s*(.*)$/.exec(s.key.trim());
  if (!km) return null;
  const tonic = pitchClass(km[1]!);
  if (tonic === null) return null;
  const minor = /minor|dorian|phrygian|aeolian|locrian/i.test(km[2]!);
  const degs = minor ? MINOR_DEG : MAJOR_DEG;
  const out: string[] = [];
  for (const [sym] of s.chords) {
    const c = parseChord(sym);
    if (!c) return null;
    const isMinor = c.tones.includes(3) && !c.tones.includes(4);
    const isDim = isMinor && c.tones.includes(6) && !c.tones.includes(7);
    let n = degs[(c.root - tonic + 12) % 12]!;
    if (isMinor) n = n.replace(/[IV]+/, (r) => r.toLowerCase());
    if (isDim) n += "°";
    if (out[out.length - 1] !== n) out.push(n);
  }
  if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  // A cycle written out twice ("i VI i VI") is the cycle once.
  for (let p = 1; p <= out.length / 2; p++) {
    if (out.length % p === 0 && out.every((x, i) => x === out[i % p])) {
      out.length = p;
      break;
    }
  }
  if (out.length < 2) return null;
  // A loop has no first chord: start it on the home chord, so "VI–i" and "i–VI" are one progression.
  const home = out.findIndex((x) => x === "I" || x === "i");
  const loop = home > 0 ? [...out.slice(home), ...out.slice(0, home)] : out;
  return { label: loop.slice(0, 4).join("–"), minor };
}
