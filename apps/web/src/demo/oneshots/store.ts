import { useSyncExternalStore } from "react";
import type { Producer } from "../data";
import { VIEWER } from "../midi/catalog";
import { MidiPlayer } from "../midi/synth";
import { saveFiles, wav, type SaveOutcome } from "../save";
import { clipBuffer, decode, deleteFile, getFile, putFile, type Category, type Kit, type KitSound } from "../kits/store";

/**
 * One-shots: every single hit on Stash in one place, whichever kit it came in, plus the loose hits
 * the viewer posts on their own. Posted hits keep their audio in this browser's IndexedDB (the same
 * store the kits use) and their details in localStorage; nothing leaves the page.
 */

export type OneShot = KitSound & {
  owner: Producer;
  genre: string;
  /** The kit it came in, when it came in one. */
  kit?: { id: string; name: string };
  /** The posted file's extension, for its download name. */
  ext?: string;
  mine?: boolean;
  postedAt: string;
};

export type Stored = { id: string; name: string; category: Category; durationMs: number; fileKey: string; ext: string; postedAt: string };

const KEY = "stash.demo.oneshots";
let memory: Stored[] = [];
let version = 0;
const listeners = new Set<() => void>();

export function loadMine(): Stored[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored[];
  } catch {
    // Memory copy.
  }
  return memory;
}

function saveMine(next: Stored[]) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // This visit only.
  }
  version++;
  for (const l of listeners) l();
}

export function useMineVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}

/** The viewer's own hits first, then every kit's sounds, newest kit first. */
export function allShots(kits: Kit[]): OneShot[] {
  const mine: OneShot[] = loadMine().map((s) => ({ ...s, owner: VIEWER, genre: "Yours", mine: true }));
  const fromKits = kits.flatMap((k) =>
    k.sounds.map((s) => ({ ...s, owner: k.owner, genre: k.genre, kit: { id: k.id, name: k.name }, mine: k.mine, postedAt: k.publishedAt })),
  );
  return [...mine, ...fromKits];
}

export type ShotDraft = { name: string; category: Category; durationMs: number; data: ArrayBuffer; ext: string };

export async function postShots(drafts: ShotDraft[]): Promise<number> {
  const now = Date.now();
  const out: Stored[] = [];
  for (const [i, d] of drafts.entries()) {
    const id = `os${now.toString(36)}${i}${Math.floor(Math.random() * 1296).toString(36)}`;
    await putFile(id, d.data);
    out.push({ id, name: d.name, category: d.category, durationMs: d.durationMs, fileKey: id, ext: d.ext, postedAt: new Date(now).toISOString() });
  }
  saveMine([...out, ...loadMine()]);
  return out.length;
}

export function removeShot(id: string) {
  void deleteFile(id);
  saveMine(loadMine().filter((s) => s.id !== id));
}

// ---------------------------------------------------------------------------------------------
// Audio for the waveform and the download.

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** The hit as audio: rendered offline from the synth, or decoded from the posted file. */
export function bufferOf(s: OneShot): Promise<AudioBuffer | null> {
  let p = buffers.get(s.id);
  if (!p) {
    p = s.hit
      ? MidiPlayer.renderHit(s.hit.pitch, s.hit.tune, s.hit.stretch, s.durationMs / 1000 + 0.25).catch(() => null)
      : s.clip
        ? clipBuffer(s.clip).catch(() => null)
        : s.fileKey
        ? getFile(s.fileKey).then((d) => (d ? decode(d) : null)).catch(() => null)
        : Promise.resolve(null);
    buffers.set(s.id, p);
  }
  return p;
}

const peakCache = new Map<string, number[]>();

/** `n` peak levels across the hit, 0 to 1, for the row's waveform. */
export async function peaksOf(s: OneShot, n = 40): Promise<number[]> {
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

export function fileName(s: OneShot): string {
  const base = s.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "one-shot";
  return `${base}.${s.hit ? "wav" : (s.ext ?? "wav")}`;
}

/** The file a download hands over: a wav of the synthesized hit, or the bytes that were posted. */
export async function fileOf(s: OneShot): Promise<Blob | null> {
  if (s.fileKey && !s.hit) {
    const d = await getFile(s.fileKey);
    return d ? new Blob([d]) : null;
  }
  const b = await bufferOf(s);
  return b ? wav(b) : null;
}

/** Saves hits as one zip (the first `max`), names made unique. "empty" when none has audio here. */
export async function saveShots(list: OneShot[], zipName: string, max = 60): Promise<{ outcome: SaveOutcome | "empty"; names: string[] }> {
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
  return { outcome: await saveFiles(zipName, files), names: files.map((f) => f.name) };
}
