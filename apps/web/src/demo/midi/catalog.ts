import type { LicenseKind, MidiKind, MidiNotesFile, MusicalKey, SoundId } from "@stash/contracts";
import { producers, type Producer } from "../data";

/**
 * The demo's MIDI items: four patterns written for the demo, plus whatever this browser's viewer
 * has posted from the upload page (kept in localStorage, like likes and follows). Each one carries
 * the notes file the worker would write (MidiNotesFile), so the piano roll and the synth read the
 * same shape the real app will.
 */

export type MidiItem = {
  id: string;
  publicId: string;
  slug: string;
  title: string;
  href: string;
  owner: Producer;
  kind: MidiKind;
  sound: SoundId;
  key: MusicalKey | null;
  notes: MidiNotesFile;
  tags: string[];
  description: string;
  license: LicenseKind;
  likes: number;
  downloads: number;
  publishedAt: string;
  fileName?: string;
  /** Posted from this browser on the upload page. */
  mine?: boolean;
};

export const VIEWER: Producer = { id: "00000000-0000-4000-8000-0000000000f0", handle: "you", displayName: "You", followers: 0 };

type N = [number, number, number, number];

/** Deterministic humanizing: a few milliseconds of push and pull, and velocity drift. */
function humanize(notes: N[], seed: number, amount = 0.015): N[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  return notes.map(([st, len, p, v]) => [Math.max(0, +(st + (st === 0 ? 0 : rnd() * amount)).toFixed(4)), len, p, Math.max(1, Math.min(127, Math.round(v + rnd() * 8)))]);
}

function file(notes: N[], bpm: number, bars: number, drums = false): MidiNotesFile {
  const sorted = [...notes].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const pitches = sorted.map((n) => n[2]);
  return { version: 1, bpm, timeSignature: [4, 4], bars, pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches), drums, notes: sorted };
}

function neoSoul(): MidiNotesFile {
  const bars: [number, number[]][] = [
    [39, [55, 58, 62, 65]], // Ebmaj9
    [36, [51, 55, 58, 62]], // Cm9
    [44, [55, 58, 60, 63]], // Abmaj9
    [46, [56, 60, 63, 67]], // Bb13sus
  ];
  const out: N[] = [];
  for (let b = 0; b < 8; b++) {
    const [bass, rh] = bars[b % 4]!;
    const t = b * 4;
    out.push([t, 2.3, bass, 92], [t + 2.5, 1.3, bass + 12, 70]);
    rh.forEach((p, i) => {
      out.push([t + i * 0.02, 1.4, p, 78 - i * 3], [t + 1.5 + i * 0.015, 0.4, p, 54], [t + 2.5 + i * 0.02, 1.4, p, 72 - i * 2]);
    });
    if (b >= 4) out.push([t + 3.5, 0.5, [74, 70, 72, 75][b - 4]!, 84]);
  }
  out.push([31, 0.25, 70, 80], [31.25, 0.25, 72, 84], [31.5, 0.5, 75, 90]);
  return file(humanize(out, 7), 84, 8);
}

function bells(): MidiNotesFile {
  const phrase: [number, number, number][][] = [
    [[0, 0.5, 73], [0.5, 0.5, 76], [1, 0.5, 73], [1.5, 0.5, 71], [2, 1, 69], [3, 0.5, 71], [3.5, 0.5, 73]],
    [[0, 0.75, 78], [0.75, 0.75, 76], [1.5, 0.5, 73], [2, 0.5, 71], [2.5, 1.5, 73]],
    [[0, 0.5, 73], [0.5, 0.5, 76], [1, 0.5, 73], [1.5, 0.5, 71], [2, 1, 69], [3, 0.25, 71], [3.25, 0.25, 73], [3.5, 0.5, 76]],
    [[0, 0.5, 71], [0.5, 0.5, 69], [1, 0.5, 66], [1.5, 0.5, 64], [2, 0.5, 66], [2.5, 0.5, 69], [3, 1, 66]],
  ];
  const out: N[] = [];
  phrase.forEach((bar, b) => {
    for (const [s, l, p] of bar) {
      out.push([b * 4 + s, l, p, s % 1 === 0 ? 100 : 82]);
      if (b % 2 === 1) out.push([b * 4 + s, l, p - 12, 60]); // the answer doubled an octave down
    }
  });
  return file(humanize(out, 11, 0.008), 150, 4);
}

function drill(): MidiNotesFile {
  const out: N[] = [];
  const kicks = [[0, 0.75, 2.5], [0, 1.25, 2.75, 3.5], [0, 0.75, 2.5], [0, 0.75, 2.5, 3.25]];
  for (let b = 0; b < 4; b++) {
    const t = b * 4;
    for (const k of kicks[b]!) out.push([t + k, 0.25, 36, k === 0 ? 120 : 104]);
    out.push([t + 2, 0.25, 38, 118], [t + 2, 0.25, 39, 90]);
    if (b % 2 === 1) out.push([t + 3.75, 0.25, 38, 72]);
    for (let h = 0; h < 8; h++) {
      const at = h * 0.5;
      if (b % 2 === 1 && at === 3) {
        for (let r = 0; r < 3; r++) out.push([t + 3 + r / 3, 1 / 6, 42, 70 + r * 12]);
        continue;
      }
      if (b === 3 && at === 3.5) {
        for (let r = 0; r < 4; r++) out.push([t + 3.5 + r / 8, 1 / 16, 42, 60 + r * 15]);
        continue;
      }
      out.push([t + at, 0.25, at === 1.5 ? 46 : 42, h % 2 === 0 ? 96 : 74]);
    }
  }
  return file(humanize(out, 23, 0.006), 142, 4, true);
}

function glide808(): MidiNotesFile {
  const bars: [number, number, number][][] = [
    [[0, 1.5, 33], [1.5, 0.5, 33], [2, 0.75, 45], [2.75, 1.25, 33]],
    [[0, 1.5, 36], [1.75, 0.25, 36], [2, 1, 40], [3, 1, 31]],
    [[0, 1.5, 29], [1.5, 0.5, 29], [2, 0.75, 41], [2.75, 1.25, 29]],
    [[0, 1.5, 31], [1.5, 0.5, 31], [2, 1, 43], [3, 0.5, 40], [3.5, 0.5, 36]],
  ];
  const out: N[] = bars.flatMap((bar, b) => bar.map(([s, l, p]): N => [b * 4 + s, l, p, s === 0 ? 120 : 100]));
  return file(out, 140, 4);
}

const built: MidiItem[] = [
  {
    n: 1, title: "Neo soul nines", slug: "neo-soul-nines", owner: producers.kilo, kind: "chords" as const, sound: "keys" as const,
    key: { root: 3, mode: "major" as const }, notes: neoSoul(), tags: ["neo soul", "chords", "rnb"],
    description: "Ebmaj9, Cm9, Abmaj9 and a Bb13sus, voiced close with the bass under. Eight bars with a little push on the second chord.",
    license: "royalty_free" as const, likes: 642, downloads: 2310, publishedAt: "2026-11-23T18:20:00Z",
  },
  {
    n: 2, title: "Pluggnb bell melody", slug: "pluggnb-bell-melody", owner: producers.nova, kind: "melody" as const, sound: "bell" as const,
    key: { root: 6, mode: "minor" as const }, notes: bells(), tags: ["pluggnb", "melody", "bells"],
    description: "F sharp minor pentatonic call and answer. The answer bars double an octave down. Try it on pluck.",
    license: "credit_required" as const, likes: 905, downloads: 3120, publishedAt: "2026-11-22T21:40:00Z",
  },
  {
    n: 3, title: "Drill drums with rolls", slug: "drill-drums-with-rolls", owner: producers.marcus, kind: "drums" as const, sound: "drums" as const,
    key: null, notes: drill(), tags: ["drill", "drums", "hat rolls"],
    description: "Half-time snare on three, sliding kick placements, triplet hat rolls on bars two and four. General MIDI drum map.",
    license: "royalty_free" as const, likes: 133, downloads: 488, publishedAt: "2026-11-23T09:15:00Z",
  },
  {
    n: 4, title: "Gliding 808 in A minor", slug: "gliding-808-in-a-minor", owner: producers.marcus, kind: "bass" as const, sound: "808" as const,
    key: { root: 9, mode: "minor" as const }, notes: glide808(), tags: ["808", "bass", "trap"],
    description: "A, C, F and G roots with octave jumps. Long notes so the 808 rings; layer it with any of the trap loops.",
    license: "royalty_free" as const, likes: 377, downloads: 1295, publishedAt: "2026-11-21T14:05:00Z",
  },
].map(({ n, ...c }) => {
  const publicId = `demomidi0${n}`;
  return { ...c, id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, publicId, href: `/midi/${c.slug}-${publicId}` };
});

// ---------------------------------------------------------------------------------------------
// The viewer's own posts

const UPLOADS = "stash.demo.uploads";
let memory: MidiItem[] = [];
const listeners = new Set<() => void>();
let version = 0;

function loadUploads(): MidiItem[] {
  try {
    const raw = window.localStorage.getItem(UPLOADS);
    if (raw) return (JSON.parse(raw) as MidiItem[]).map((m) => ({ ...m, owner: VIEWER, mine: true }));
  } catch {
    // Blocked or malformed: this visit's memory copy stands.
  }
  return memory;
}

export function postUpload(item: Omit<MidiItem, "id" | "publicId" | "href" | "owner" | "likes" | "downloads" | "publishedAt" | "mine">): MidiItem {
  const publicId = `up${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36)}`.slice(0, 16);
  const slug = item.slug || "midi";
  const full: MidiItem = {
    ...item,
    slug,
    id: `upload-${publicId}`,
    publicId,
    href: `/midi/${slug}-${publicId}`,
    owner: VIEWER,
    likes: 0,
    downloads: 0,
    publishedAt: new Date().toISOString(),
    mine: true,
  };
  const next = [full, ...loadUploads()];
  memory = next;
  try {
    window.localStorage.setItem(UPLOADS, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
  version++;
  for (const l of listeners) l();
  return full;
}

export function removeUpload(publicId: string) {
  const next = loadUploads().filter((m) => m.publicId !== publicId);
  memory = next;
  try {
    window.localStorage.setItem(UPLOADS, JSON.stringify(next));
  } catch {
    // Memory copy above.
  }
  version++;
  for (const l of listeners) l();
}

export function subscribeMidi(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
export const midiVersion = () => version;

/** Every MIDI item, the viewer's posts first, then newest first. */
export function midiItems(): MidiItem[] {
  return [...loadUploads(), ...[...built].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))];
}

export function midiItem(publicId: string): MidiItem | null {
  return midiItems().find((m) => m.publicId === publicId) ?? null;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/#/g, "s").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "midi";
}
