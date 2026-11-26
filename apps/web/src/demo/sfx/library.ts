import { getEngine } from "@stash/audio";
import { useSyncExternalStore } from "react";
import { audioContext } from "../kits/store";
import { midiPlayer } from "../midi/synth";
import { saveFiles, wav, type SaveOutcome } from "../save";
import { onSilence, silenceOthers } from "../exclusive";
import data from "./library.json";

/**
 * The SFX library: sound effects sorted into categories and subcategories, like a big stock-sound
 * site. scripts/build-demo-sfx.py makes library.json and the media: originals synthesized from
 * scratch plus public-domain and CC0 recordings from Wikimedia Commons, each with its source and
 * license. The sounds of one subcategory share one mp3 ("sprite"); a sound is a slice of it.
 */

export type SfxSource =
  | { kind: "original"; license: string; by: string }
  | { kind: "recording"; license: string; by: string; page: string; title: string };

export type Sfx = {
  id: string;
  name: string;
  cat: string;
  sub: string;
  tags: string[];
  file: string;
  start: number;
  duration: number;
  stereo: boolean;
  peaks: number[];
  source: SfxSource;
};

export type SfxCategory = { id: string; name: string; subs: { id: string; name: string }[] };

const lib = data as unknown as { categories: SfxCategory[]; sounds: Sfx[] };

export const SFX: Sfx[] = lib.sounds;
/** Only the categories and subcategories that have sounds. */
export const SFX_CATEGORIES: SfxCategory[] = lib.categories
  .map((c) => ({ ...c, subs: c.subs.filter((s) => SFX.some((x) => x.cat === c.id && x.sub === s.id)) }))
  .filter((c) => c.subs.length > 0);

export function categoryName(id: string): string {
  return lib.categories.find((c) => c.id === id)?.name ?? id;
}
export function subName(cat: string, sub: string): string {
  return lib.categories.find((c) => c.id === cat)?.subs.find((s) => s.id === sub)?.name ?? sub;
}

export function licenseLabel(s: Sfx): string {
  const l = s.source.license.toLowerCase();
  if (l.includes("cc0") || l.includes("zero")) return "CC0";
  if (l.startsWith("pd")) return "Public domain";
  return s.source.license;
}

/** What the row says about where the sound came from. */
export function sourceLine(s: Sfx): string {
  return s.source.kind === "original" ? "Stash original" : `Recorded by ${s.source.by}`;
}

/** Lowercase text the search matches against. */
export function haystack(s: Sfx): string {
  return [s.name, subName(s.cat, s.sub), ...s.tags].join(" ").toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// Audio

const sprites = new Map<string, Promise<AudioBuffer>>();

function spriteUrl(file: string): string {
  return new URL(`demo/sfx/${file}`, document.baseURI).href;
}

/** The decoded sprite a sound lives in, fetched once. */
export function sprite(file: string): Promise<AudioBuffer> {
  let p = sprites.get(file);
  if (!p) {
    p = fetch(spriteUrl(file), { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(`sprite ${file}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => audioContext().decodeAudioData(b));
    p.catch(() => sprites.delete(file));
    sprites.set(file, p);
  }
  return p;
}

/** Starts fetching a sound's sprite (on hover), so the click plays at once. */
export function warm(s: Sfx) {
  void sprite(s.file).catch(() => undefined);
}

type PlayingState = { id: string | null; loading: string | null; startedAt: number; duration: number; error: string | null };
let state: PlayingState = { id: null, loading: null, startedAt: 0, duration: 0, error: null };
const listeners = new Set<() => void>();
let node: AudioBufferSourceNode | null = null;
let token = 0;

function set(next: Partial<PlayingState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function usePlaying(): PlayingState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Seconds into the playing sound, for the waveform's progress. */
export function position(): number {
  if (!state.id) return 0;
  return Math.min(state.duration, audioContext().currentTime - state.startedAt);
}

function stopOthers() {
  const engine = getEngine();
  const st = engine.getState().status;
  if (st === "playing" || st === "loading") engine.pause();
  midiPlayer().pause();
}

export function stop() {
  token++;
  try {
    node?.stop();
  } catch {
    // Already ended.
  }
  node = null;
  set({ id: null, loading: null });
}
onSilence(stop);

/** Plays a sound from `from` seconds in; playing the same one again stops it. */
export async function playSfx(s: Sfx, from = 0, toggle = true) {
  if (toggle && state.id === s.id && from === 0) {
    stop();
    return;
  }
  stop();
  stopOthers();
  silenceOthers(stop);
  const mine = ++token;
  set({ loading: s.id, error: null });
  let buf: AudioBuffer;
  try {
    buf = await sprite(s.file);
  } catch {
    if (mine === token) set({ loading: null, error: s.id });
    return;
  }
  if (mine !== token) return;
  const c = audioContext();
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  const offset = Math.max(0, Math.min(s.duration - 0.02, from));
  src.start(0, s.start + offset, s.duration - offset);
  node = src;
  src.onended = () => {
    if (node === src) {
      node = null;
      set({ id: null });
    }
  };
  set({ id: s.id, loading: null, startedAt: c.currentTime - offset, duration: s.duration });
}

// ---------------------------------------------------------------------------------------------
// Download

export function fileName(s: Sfx): string {
  const base = s.name.replace(/\(gibberish\)/i, "").replace(/[^\w\- ]+/g, " ").trim().replace(/\s+/g, "_");
  return `Stash_SFX_${base || s.id}.wav`;
}

/** A plain-text note of the license that goes in the zip with the sound. */
export function licenseNote(s: Sfx): string {
  const lines = [`${s.name}`, `From the Stash SFX library (${categoryName(s.cat)} / ${subName(s.cat, s.sub)}).`, ""];
  if (s.source.kind === "original") {
    lines.push("A Stash original, synthesized from scratch. Released under CC0 1.0: use it in anything, sold or free, no credit needed.");
  } else {
    lines.push(`Recorded by ${s.source.by}. License: ${s.source.license} (${licenseLabel(s)}).`);
    lines.push(`Source: ${s.source.page}`);
    lines.push("Public domain and CC0 sounds can be used in anything, sold or free, with no credit required. Crediting the recordist is a kind thing to do.");
  }
  return lines.join("\n") + "\n";
}

/** The sound as a 44.1 kHz wav, cut from its sprite. */
export async function wavOf(s: Sfx): Promise<Blob> {
  const buf = await sprite(s.file);
  const a = Math.floor(s.start * buf.sampleRate);
  const len = Math.min(buf.length - a, Math.ceil(s.duration * buf.sampleRate));
  const ch = s.stereo ? buf.numberOfChannels : 1;
  const out = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: buf.sampleRate });
  for (let c = 0; c < ch; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, a + len), c);
  return wav(out);
}

export async function downloadSfx(list: Sfx[], zipName: string): Promise<SaveOutcome | "empty"> {
  const files: { name: string; data: Blob }[] = [];
  const used = new Set<string>();
  const notes: string[] = [];
  for (const s of list) {
    let name = fileName(s);
    for (let i = 2; used.has(name); i++) name = fileName(s).replace(/\.wav$/, `_${i}.wav`);
    used.add(name);
    files.push({ name, data: await wavOf(s) });
    notes.push(`${name}\n${licenseNote(s)}`);
  }
  if (files.length === 0) return "empty";
  files.push({ name: "LICENSE.txt", data: new Blob([notes.join("\n")], { type: "text/plain" }) });
  return saveFiles(zipName, files, { title: list.length === 1 ? zipName.replace(/_/g, " ") : `${zipName.replace(/_/g, " ")} (${list.length} sounds)`, kind: list.length === 1 ? "Sound effect" : "Sound effect pack", by: "Stash" });
}
