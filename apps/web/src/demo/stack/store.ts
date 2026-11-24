import type { MidiKind, MusicalKey, SoundId } from "@stash/contracts";
import { useMemo, useSyncExternalStore } from "react";
import { midiItems, midiVersion, subscribeMidi, type MidiItem } from "../midi/catalog";

/**
 * The stack: up to four MIDI items heard together at one tempo and, for the melodic ones, one key.
 * The working stack and the saved stacks live in this browser (localStorage), like likes and posts.
 * Pure helpers (keyShift, resolveStack) are exported for the player, the page and the unit tests.
 */

export const MAX_LAYERS = 4;
const SAVED_KEY = "stash.demo.stacks";
const CURRENT_KEY = "stash.demo.stack";

export type StackLayer = {
  /** Unique inside the stack: the same item can sit in two layers. */
  uid: string;
  /** MidiItem.id */
  itemId: string;
  sound: SoundId;
  /** 0 to 1 */
  volume: number;
  muted: boolean;
  solo: boolean;
};

export type StackState = {
  layers: StackLayer[];
  /** Null follows the first layer's BPM. */
  bpm: number | null;
  /** Null follows the first melodic layer's key. */
  key: MusicalKey | null;
  matchKeys: boolean;
};

export type SavedStack = { id: string; name: string; savedAt: string; stack: StackState };

export type StarterStack = { id: string; name: string; blurb: string; items: string[]; bpm?: number };

/** Starter stacks, by MIDI public id, so the page has something to play on the first visit. */
export const STARTERS: StarterStack[] = [
  { id: "plugg", name: "Plugg starter", blurb: "Plugg chords in B flat, the Pluggnb bell melody and trap drums with hat rolls.", items: ["demomidi07", "demomidi02", "demomidi10"] },
  { id: "dark-trap", name: "Dark trap", blurb: "Dark trap piano in C minor over the gliding 808 and trap drums.", items: ["demomidi05", "demomidi04", "demomidi10"] },
  { id: "phonk", name: "Memphis phonk", blurb: "The cowbell melody and its 808 line on the drill drums.", items: ["demomidi12", "demomidi13", "demomidi03"] },
  { id: "uk-drill", name: "UK drill", blurb: "Drill strings in C sharp minor, the 808 slid under them, drill drums with rolls.", items: ["demomidi14", "demomidi04", "demomidi03"] },
  { id: "boom-bap", name: "Boom bap session", blurb: "Boom bap Rhodes, swung drums and an 808 moved into D minor.", items: ["demomidi06", "demomidi04", "demomidi09"] },
  { id: "rage", name: "Rage", blurb: "Rage stab lead in F minor, the phonk 808 and trap drums at 160.", items: ["demomidi08", "demomidi13", "demomidi10"] },
  { id: "melodic-trap", name: "Melodic trap", blurb: "The guitar-style arp in E minor with the 808 and trap drums.", items: ["demomidi18", "demomidi04", "demomidi10"] },
  { id: "lofi", name: "Lo-fi", blurb: "Lo-fi nines with swung boom bap drums, slowed to 80.", items: ["demomidi16", "demomidi09"], bpm: 80 },
];

// ---------------------------------------------------------------------------------------------
// Keys

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

/** "F minor", "B flat major": the key as the readouts say it. */
export function keyName(key: MusicalKey): string {
  const n = NAMES[((key.root % 12) + 12) % 12]!.replace(/b$/, " flat").replace("#", " sharp");
  return `${n} ${key.mode}`;
}

/** "Fm", "Bb": short form for chips. */
export function keyShort(key: MusicalKey): string {
  return `${NAMES[((key.root % 12) + 12) % 12]}${key.mode === "minor" ? "m" : ""}`;
}

/** The root a layer in `mode` should land on for `target`: the target's root, or its relative. */
export function matchRoot(mode: MusicalKey["mode"], target: MusicalKey): number {
  if (mode === target.mode) return target.root;
  return mode === "minor" ? (target.root + 9) % 12 : (target.root + 3) % 12;
}

/** The smallest shift (−6 to +5 semitones) that moves `key` onto `target` (or its relative). */
export function keyShift(key: MusicalKey | null, target: MusicalKey | null): number {
  if (!key || !target) return 0;
  const d = (((matchRoot(key.mode, target) - key.root) % 12) + 12) % 12;
  return ((d + 6) % 12) - 6;
}

export function isDrums(item: Pick<MidiItem, "kind" | "notes">): boolean {
  return item.kind === "drums" || item.notes.drums;
}

export function lengthBeats(item: Pick<MidiItem, "notes">): number {
  const [n, d] = item.notes.timeSignature;
  return item.notes.bars * ((n * 4) / d);
}

// ---------------------------------------------------------------------------------------------
// Resolving a stack against the catalog

export type ResolvedLayer = StackLayer & {
  item: MidiItem;
  index: number;
  drums: boolean;
  /** Semitones applied (0 for drums, unknown keys, or match keys off). */
  transpose: number;
  /** The key the layer sounds in now. */
  soundingKey: MusicalKey | null;
  /** "+3 to match F minor", "In F minor", "Drums: no key", "Key unknown". */
  readout: string;
  /** Not muted, and soloed if anything is. */
  audible: boolean;
  lengthBeats: number;
};

export type ResolvedStack = {
  layers: ResolvedLayer[];
  bpm: number;
  /** The tempo the stack would follow with no override. */
  baseBpm: number;
  key: MusicalKey | null;
  baseKey: MusicalKey | null;
  matchKeys: boolean;
  /** The loop: the longest layer, in beats. */
  lengthBeats: number;
  beatsPerBar: number;
};

export function resolveStack(state: StackState, items: MidiItem[]): ResolvedStack {
  const byId = new Map(items.map((m) => [m.id, m]));
  const present = state.layers.flatMap((l) => {
    const item = byId.get(l.itemId);
    return item ? [{ l, item }] : [];
  });
  const baseBpm = Math.round(present[0]?.item.notes.bpm ?? 120);
  const firstMelodic = present.find(({ item }) => !isDrums(item) && item.key);
  const baseKey = firstMelodic?.item.key ?? null;
  const key = state.key ?? baseKey;
  const anySolo = present.some(({ l }) => l.solo);
  const layers = present.map(({ l, item }, index): ResolvedLayer => {
    const drums = isDrums(item);
    const transpose = drums || !state.matchKeys ? 0 : keyShift(item.key, key);
    const soundingKey = item.key ? { root: (((item.key.root + transpose) % 12) + 12) % 12, mode: item.key.mode } : null;
    let readout: string;
    if (drums) readout = "Drums: no key";
    else if (!item.key) readout = "Key unknown";
    else if (!state.matchKeys || !key) readout = `In ${keyName(item.key)}`;
    else if (transpose === 0) readout = `In ${keyName(soundingKey!)}`;
    else readout = `${transpose > 0 ? "+" : "−"}${Math.abs(transpose)} to match ${keyName(soundingKey!)}`;
    return { ...l, item, index, drums, transpose, soundingKey, readout, audible: !l.muted && (!anySolo || l.solo), lengthBeats: lengthBeats(item) };
  });
  const first = present[0]?.item.notes.timeSignature ?? [4, 4];
  return {
    layers,
    bpm: state.bpm ?? baseBpm,
    baseBpm,
    key,
    baseKey,
    matchKeys: state.matchKeys,
    lengthBeats: Math.max(0, ...layers.map((l) => l.lengthBeats)),
    beatsPerBar: (first[0] * 4) / first[1],
  };
}

// ---------------------------------------------------------------------------------------------
// State and storage

const EMPTY: StackState = { layers: [], bpm: null, key: null, matchKeys: true };

let state: StackState = EMPTY;
let saved: SavedStack[] = [];
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();

function read<T>(k: string): T | null {
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, v: unknown) {
  try {
    window.localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // Blocked or full: this visit's memory copy stands.
  }
}

function sane(s: StackState | null): StackState | null {
  if (!s || !Array.isArray(s.layers)) return null;
  return {
    layers: s.layers.slice(0, MAX_LAYERS).filter((l) => l && typeof l.itemId === "string"),
    bpm: typeof s.bpm === "number" ? s.bpm : null,
    key: s.key && typeof s.key.root === "number" ? s.key : null,
    matchKeys: s.matchKeys !== false,
  };
}

function ensure() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  const cur = sane(read<StackState>(CURRENT_KEY));
  const list = read<SavedStack[]>(SAVED_KEY);
  saved = Array.isArray(list) ? list.filter((s) => s && sane(s.stack)).map((s) => ({ ...s, stack: sane(s.stack)! })) : [];
  // First visit: start on the first starter so the page plays something straight away.
  state = cur ?? (list ? EMPTY : fromStarter(STARTERS[0]!));
}

function emit(persist = true) {
  version++;
  if (persist) write(CURRENT_KEY, state);
  for (const l of listeners) l();
}

let uidSeq = 0;
const uid = () => `l${Date.now().toString(36)}${(uidSeq++).toString(36)}`;

function findItem(idOrPublicId: string): MidiItem | null {
  return midiItems().find((m) => m.id === idOrPublicId || m.publicId === idOrPublicId) ?? null;
}

function layerFor(item: MidiItem): StackLayer {
  return { uid: uid(), itemId: item.id, sound: item.sound, volume: item.kind === "drums" ? 0.85 : 0.75, muted: false, solo: false };
}

function fromStarter(s: StarterStack): StackState {
  const layers = s.items.flatMap((id) => {
    const m = findItem(id);
    return m ? [layerFor(m)] : [];
  });
  return { layers, bpm: s.bpm ?? null, key: null, matchKeys: true };
}

export function subscribeStack(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
export const stackVersion = () => {
  ensure();
  return version;
};

export function getStack(): StackState {
  ensure();
  return state;
}

export function getSaved(): SavedStack[] {
  ensure();
  return saved;
}

let resolvedCache: { v: number; mv: number; r: ResolvedStack } | null = null;
/** The working stack resolved against the catalog, cached until either changes. */
export function getResolved(): ResolvedStack {
  ensure();
  const mv = midiVersion();
  if (!resolvedCache || resolvedCache.v !== version || resolvedCache.mv !== mv) resolvedCache = { v: version, mv, r: resolveStack(state, midiItems()) };
  return resolvedCache.r;
}

function update(next: Partial<StackState>) {
  ensure();
  state = { ...state, ...next };
  emit();
}

function updateLayer(id: string, patch: Partial<StackLayer>) {
  update({ layers: getStack().layers.map((l) => (l.uid === id ? { ...l, ...patch } : l)) });
}

/** Adds a MIDI item (by id or public id) as a new layer. Does nothing when the stack is full. */
export function addToStack(itemId: string): void {
  ensure();
  const item = findItem(itemId);
  if (!item || state.layers.length >= MAX_LAYERS) return;
  update({ layers: [...state.layers, layerFor(item)] });
}

export function stackCount(): number {
  return getStack().layers.length;
}

export function inStack(itemId: string): boolean {
  const item = findItem(itemId);
  return !!item && getStack().layers.some((l) => l.itemId === item.id);
}

export function stackFull(): boolean {
  return stackCount() >= MAX_LAYERS;
}

export const removeLayer = (id: string) => update({ layers: getStack().layers.filter((l) => l.uid !== id) });
export const setLayerSound = (id: string, sound: SoundId) => updateLayer(id, { sound });
export const setLayerVolume = (id: string, volume: number) => updateLayer(id, { volume: Math.max(0, Math.min(1, volume)) });
export const setLayerMuted = (id: string, muted: boolean) => updateLayer(id, { muted });
export const setLayerSolo = (id: string, solo: boolean) => updateLayer(id, { solo });
export const setStackBpm = (bpm: number | null) => update({ bpm: bpm === null ? null : Math.round(bpm) });
export const setStackKey = (key: MusicalKey | null) => update({ key });
export const setMatchKeys = (matchKeys: boolean) => update({ matchKeys });
export const clearStack = () => update({ ...EMPTY });

export function loadStarter(id: string) {
  const s = STARTERS.find((x) => x.id === id);
  if (!s) return;
  ensure();
  state = fromStarter(s);
  emit();
}

export function saveStack(name: string): SavedStack | null {
  ensure();
  if (state.layers.length === 0) return null;
  const entry: SavedStack = { id: `s${Date.now().toString(36)}${(uidSeq++).toString(36)}`, name: name.trim() || defaultName(), savedAt: new Date().toISOString(), stack: state };
  saved = [entry, ...saved];
  write(SAVED_KEY, saved);
  emit(false);
  return entry;
}

export function loadSaved(id: string) {
  const s = getSaved().find((x) => x.id === id);
  if (!s) return;
  state = { ...s.stack, layers: s.stack.layers.map((l) => ({ ...l, uid: uid() })) };
  emit();
}

export function deleteSaved(id: string) {
  saved = getSaved().filter((s) => s.id !== id);
  write(SAVED_KEY, saved);
  emit(false);
}

/** A name from the layers: "Plugg chords in B flat + Pluggnb bell melody". */
export function defaultName(): string {
  const titles = getResolved().layers.map((l) => l.item.title);
  return titles.length ? titles.slice(0, 2).join(" + ") + (titles.length > 2 ? ` + ${titles.length - 2} more` : "") : "Untitled stack";
}

// ---------------------------------------------------------------------------------------------
// React

export function useStack(): ResolvedStack {
  useSyncExternalStore(subscribeMidi, midiVersion, midiVersion);
  useSyncExternalStore(subscribeStack, stackVersion, stackVersion);
  return getResolved();
}

export function useSavedStacks(): SavedStack[] {
  const v = useSyncExternalStore(subscribeStack, stackVersion, stackVersion);
  return useMemo(() => getSaved(), [v]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** For "Add to stack" buttons: the layer count, live. */
export function useStackCount(): number {
  useSyncExternalStore(subscribeStack, stackVersion, stackVersion);
  return stackCount();
}

export const KIND_ORDER: MidiKind[] = ["chords", "melody", "bass", "drums"];
