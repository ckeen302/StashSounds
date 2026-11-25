import { getEngine } from "@stash/audio";
import { useSyncExternalStore } from "react";
import { producers, type Producer } from "../data";
import { extra, VIEWER } from "../midi/catalog";
import { midiPlayer } from "../midi/synth";

/**
 * Drum kits: folders of one-shots (kicks, snares, hats...) that producers post and others grab.
 * The demo's own kits are synthesized in the browser, so no one's samples are hosted here. Kits the
 * viewer uploads keep their audio in this browser's IndexedDB and their details in localStorage;
 * nothing leaves the page.
 */

export type Category = "kick" | "808" | "snare" | "clap" | "hat" | "open hat" | "perc" | "cymbal" | "fx" | "vox" | "other";

export const CATEGORIES: { id: Category; label: string; plural: string; match: RegExp }[] = [
  { id: "808", label: "808", plural: "808s", match: /808|\bsub\b|\bbass\b/i },
  { id: "kick", label: "Kick", plural: "Kicks", match: /kick|kik|\bbd\b|bassdrum/i },
  { id: "open hat", label: "Open hat", plural: "Open hats", match: /open|\boh\b|o[-_ ]?hat/i },
  { id: "hat", label: "Hi-hat", plural: "Hi-hats", match: /hat|hh|hihat|\bch\b|shaker/i },
  { id: "snare", label: "Snare", plural: "Snares", match: /snare|\bsn\b|\bsd\b|rim/i },
  { id: "clap", label: "Clap", plural: "Claps", match: /clap|\bclp\b|snap/i },
  { id: "cymbal", label: "Cymbal", plural: "Cymbals", match: /crash|ride|cym|splash|china/i },
  { id: "perc", label: "Perc", plural: "Percs", match: /perc|tom|conga|bongo|cowbell|bell|tamb|wood|block|shaker|clave/i },
  { id: "fx", label: "FX", plural: "FX", match: /fx|riser|sweep|impact|reverse|rev\b|noise|transition|downlifter/i },
  { id: "vox", label: "Vox", plural: "Vox", match: /vox|vocal|chant|adlib|tag|voice|hey|yeah/i },
  { id: "other", label: "Other", plural: "Other", match: /$^/ },
];

export function categoryOf(fileName: string): Category {
  // Underscores and dashes count as spaces, so "808_bass-01" reads as words.
  const name = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ");
  return CATEGORIES.find((c) => c.match.test(name))?.id ?? "other";
}

export function labelOf(c: Category): string {
  return CATEGORIES.find((x) => x.id === c)!.label;
}

/** A readable sound name from a file name: "KICK_hard_03.wav" -> "KICK hard 03". */
export function cleanName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Sound";
}

export type Hit = { pitch: number; tune: number; stretch: number };
export type KitSound = { id: string; name: string; category: Category; durationMs: number; hit?: Hit; fileKey?: string };
export type Kit = {
  id: string;
  name: string;
  owner: Producer;
  genre: string;
  description: string;
  sounds: KitSound[];
  likes: number;
  downloads: number;
  publishedAt: string;
  mine?: boolean;
};

// ---------------------------------------------------------------------------------------------
// The demo's kits, synthesized: each sound is a drum voice from the MIDI synth, tuned and stretched.

type Def = [name: string, category: Category, pitch: number, tune?: number, stretch?: number];

function demoKit(n: number, name: string, owner: Producer, genre: string, description: string, publishedAt: string, defs: Def[]): Kit {
  const id = `demokit${String(n).padStart(2, "0")}`;
  return {
    id,
    name,
    owner,
    genre,
    description,
    // Made for the demo: no invented counts.
    likes: 0,
    downloads: 0,
    publishedAt,
    sounds: defs.map(([sname, category, pitch, tune = 1, stretch = 1], i) => ({
      id: `${id}-${i}`,
      name: sname,
      category,
      durationMs: Math.round((pitch === 36 || pitch === 35 ? 500 : pitch === 49 || pitch === 57 ? 1400 : pitch === 46 ? 320 : 200) * stretch),
      hit: { pitch, tune, stretch },
    })),
  };
}

const DEMO_KITS: Kit[] = [
  demoKit(1, "Night Shift trap kit", producers.nova, "Trap", "Long 808s, crisp claps and tight hats made for rolls. Everything tuned to sit together at 140.", "2026-11-22T18:00:00Z", [
    ["Night 808 long", "808", 36, 0.8, 4], ["Night 808 short", "808", 36, 0.85, 1.6], ["Night 808 punch", "808", 36, 0.92, 2.4],
    ["Night kick hard", "kick", 36, 1.15, 0.8], ["Night kick soft", "kick", 35, 1.05, 0.9],
    ["Night snare", "snare", 38, 1.05], ["Night snare tight", "snare", 40, 1.2, 0.7], ["Night rim", "snare", 37],
    ["Night clap", "clap", 39], ["Night clap wide", "clap", 39, 0.9, 1.3], ["Night snap", "clap", 39, 1.6, 0.5],
    ["Night hat", "hat", 42, 1.1], ["Night hat tight", "hat", 42, 1.4, 0.5], ["Night hat dark", "hat", 42, 0.85],
    ["Night open hat", "open hat", 46, 1, 0.8], ["Night perc high", "perc", 50, 1.5, 0.5], ["Night crash", "cymbal", 49],
  ]),
  demoKit(2, "Dusty Crates boom bap kit", producers.kilo, "Boom bap", "Fat kicks, cracking snares and swung-feel hats, tuned low and a little dirty.", "2026-11-20T15:30:00Z", [
    ["Crates kick", "kick", 36, 0.9, 1.1], ["Crates kick deep", "kick", 35, 0.8, 1.3], ["Crates kick short", "kick", 36, 1, 0.7],
    ["Crates snare", "snare", 38, 0.9, 1.3], ["Crates snare ghost", "snare", 38, 1.1, 0.5], ["Crates snare crack", "snare", 40, 0.95, 1.1],
    ["Crates clap", "clap", 39, 0.85, 1.2], ["Crates rim", "snare", 37, 0.9],
    ["Crates hat", "hat", 42, 0.9, 1.2], ["Crates shaker", "hat", 42, 0.8, 1.4], ["Crates pedal hat", "hat", 44, 0.85],
    ["Crates open hat", "open hat", 46, 0.85, 1.1], ["Crates conga", "perc", 50, 1.2, 0.8], ["Crates tom", "perc", 45, 0.9], ["Crates ride", "cymbal", 51, 0.85],
  ]),
  demoKit(3, "Southside of the river drill kit", producers.marcus, "Drill", "Sliding 808s, late snares and skippy hats for UK and NY drill.", "2026-11-23T09:00:00Z", [
    ["River 808 slide", "808", 36, 0.72, 4.5], ["River 808 punch", "808", 36, 0.9, 2], ["River kick", "kick", 36, 1.2, 0.7],
    ["River snare", "snare", 38, 1.15, 0.9], ["River snare 2", "snare", 40, 1.25, 0.7], ["River clap", "clap", 39, 1.1, 0.8], ["River rim", "snare", 37, 1.2],
    ["River hat", "hat", 42, 1.2, 0.8], ["River hat skip", "hat", 42, 1.5, 0.4], ["River open hat", "open hat", 46, 1.1, 0.6],
    ["River perc", "perc", 50, 1.7, 0.4], ["River perc low", "perc", 45, 1.4, 0.5], ["River splash", "cymbal", 55, 1.2, 0.6],
  ]),
  demoKit(4, "Memphis Ghost phonk kit", extra.dre, "Phonk", "Cowbells, hard 808s and Memphis hats. Push it through distortion.", "2026-11-21T22:10:00Z", [
    ["Ghost 808", "808", 36, 0.78, 3], ["Ghost 808 dist", "808", 36, 0.82, 2.2], ["Ghost kick", "kick", 36, 1.05], ["Ghost kick 2", "kick", 35, 0.95],
    ["Ghost snare", "snare", 38, 1.2, 0.8], ["Ghost clap", "clap", 39, 1.15, 1.1], ["Ghost snap", "clap", 39, 1.8, 0.4],
    ["Ghost cowbell", "perc", 50, 2.6, 0.9], ["Ghost cowbell low", "perc", 48, 2.4, 0.9], ["Ghost rim", "snare", 37, 1.1],
    ["Ghost hat", "hat", 42, 1.05], ["Ghost shaker", "hat", 44, 1.3, 0.8], ["Ghost open hat", "open hat", 46, 1.1, 0.7], ["Ghost crash", "cymbal", 49, 0.9],
  ]),
  demoKit(5, "Bounce House jersey club kit", extra.juno, "Jersey club", "The kicks and claps for the bounce, plus the squeak.", "2026-11-19T12:00:00Z", [
    ["Bounce kick", "kick", 36, 1.05, 0.9], ["Bounce kick 2", "kick", 35], ["Bounce 808", "808", 36, 0.8, 2.4],
    ["Bounce clap", "clap", 39, 1.05], ["Bounce snap", "clap", 39, 1.5, 0.5], ["Bounce snare", "snare", 38, 1.1],
    ["Bed squeak", "fx", 50, 2.2, 0.35], ["Bounce hat", "hat", 42, 1.1], ["Bounce open hat", "open hat", 46],
    ["Bounce tom low", "perc", 41, 1.1], ["Bounce tom high", "perc", 48, 1.1], ["Bounce crash", "cymbal", 49],
  ]),
  demoKit(6, "Velvet R&B kit", producers.kilo, "R&B", "Soft kicks, brushed snares and quiet hats for slow songs.", "2026-11-17T20:00:00Z", [
    ["Velvet kick", "kick", 36, 0.95, 0.9], ["Velvet kick sub", "808", 36, 0.75, 2.8], ["Velvet snare soft", "snare", 38, 0.85, 1.4],
    ["Velvet snap", "clap", 39, 1.4, 0.6], ["Velvet rim", "snare", 37, 0.8], ["Velvet hat", "hat", 42, 0.75, 1.1],
    ["Velvet shaker", "hat", 44, 0.7, 1.5], ["Velvet ride", "cymbal", 51, 0.8], ["Velvet perc", "perc", 47, 1.3, 0.6],
  ]),
];

// ---------------------------------------------------------------------------------------------
// The viewer's kits: details in localStorage, audio in IndexedDB.

const KEY = "stash.demo.kits";
let memory: Kit[] = [];
let version = 0;
const listeners = new Set<() => void>();

function loadMine(): Kit[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return (JSON.parse(raw) as Kit[]).map((k) => ({ ...k, owner: VIEWER, mine: true }));
  } catch {
    // Memory copy.
  }
  return memory;
}

function saveMine(next: Kit[]) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // This visit only.
  }
  version++;
  for (const l of listeners) l();
}

export function kits(): Kit[] {
  return [...loadMine(), ...[...DEMO_KITS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))];
}

export function kit(id: string): Kit | null {
  return kits().find((k) => k.id === id) ?? null;
}

export function useKits(): Kit[] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  void v;
  return kits();
}

// IndexedDB, one store of ArrayBuffers keyed by sound id. Falls back to memory when blocked.
const memFiles = new Map<string, ArrayBuffer>();
function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("stash-demo", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kit-files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
export async function putFile(key: string, data: ArrayBuffer) {
  memFiles.set(key, data);
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction("kit-files", "readwrite");
    tx.objectStore("kit-files").put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
export async function getFile(key: string): Promise<ArrayBuffer | null> {
  const m = memFiles.get(key);
  if (m) return m;
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    const req = d.transaction("kit-files").objectStore("kit-files").get(key);
    req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}
export async function deleteFile(key: string) {
  memFiles.delete(key);
  const d = await db();
  if (!d) return;
  d.transaction("kit-files", "readwrite").objectStore("kit-files").delete(key);
}

export type Draft = { name: string; category: Category; durationMs: number; data: ArrayBuffer };

export async function postKit(name: string, genre: string, description: string, sounds: Draft[]): Promise<Kit> {
  const id = `up${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
  const out: KitSound[] = [];
  for (const [i, s] of sounds.entries()) {
    const fileKey = `${id}-${i}`;
    await putFile(fileKey, s.data);
    out.push({ id: fileKey, name: s.name, category: s.category, durationMs: s.durationMs, fileKey });
  }
  const k: Kit = { id, name: name.trim() || "My kit", owner: VIEWER, genre, description, sounds: out, likes: 0, downloads: 0, publishedAt: new Date().toISOString(), mine: true };
  saveMine([k, ...loadMine()]);
  return k;
}

export function removeKit(id: string) {
  const k = loadMine().find((x) => x.id === id);
  for (const s of k?.sounds ?? []) if (s.fileKey) void deleteFile(s.fileKey);
  saveMine(loadMine().filter((x) => x.id !== id));
}

// ---------------------------------------------------------------------------------------------
// Playback: synthesized hits through the MIDI synth, files through a small player of our own.

let ctx: AudioContext | null = null;
const decoded = new Map<string, AudioBuffer>();
let playingNode: AudioBufferSourceNode | null = null;

export function audioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Decodes a file to learn its length; throws when the browser cannot read it. */
export async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  return audioContext().decodeAudioData(data.slice(0));
}

function stopOthers() {
  const engine = getEngine();
  const st = engine.getState().status;
  if (st === "playing" || st === "loading") engine.pause();
  midiPlayer().pause();
}

/** Plays one sound now. A draft plays from its bytes before it is posted. */
export async function play(sound: KitSound | Draft, key?: string) {
  stopOthers();
  if ("hit" in sound && sound.hit) {
    midiPlayer().hit(sound.hit.pitch, 112, sound.hit.tune, sound.hit.stretch);
    return;
  }
  const id = key ?? ("fileKey" in sound ? sound.fileKey : undefined);
  let buf = id ? decoded.get(id) : undefined;
  if (!buf) {
    const data = "data" in sound ? sound.data : sound.fileKey ? await getFile(sound.fileKey) : null;
    if (!data) return;
    buf = await decode(data);
    if (id) decoded.set(id, buf);
  }
  playBuffer(buf, false);
}

/** Plays a buffer now, cutting off whatever one-shot played before it. */
export function playBuffer(buf: AudioBuffer, stop = true) {
  if (stop) stopOthers();
  const c = audioContext();
  playingNode?.stop();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start();
  playingNode = src;
}
