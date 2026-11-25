import { useSyncExternalStore } from "react";

/**
 * Crates: the viewer's own collections of sounds, like a crate of records. Kept in this browser.
 * An entry is a loop row id or a MIDI item id; both are unique across the demo.
 */
export type Crate = { id: string; name: string; items: string[]; createdAt: string };

const KEY = "stash.demo.crates";
let memory: Crate[] = [];
let version = 0;
const listeners = new Set<() => void>();

function load(): Crate[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Crate[];
  } catch {
    // Memory copy.
  }
  return memory;
}

function save(next: Crate[]) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // This visit only.
  }
  version++;
  for (const l of listeners) l();
}

export function crates(): Crate[] {
  return load();
}

export function createCrate(name: string, firstItem?: string): Crate {
  const c: Crate = { id: `crate-${Date.now().toString(36)}`, name: name.trim().slice(0, 40) || "New crate", items: firstItem ? [firstItem] : [], createdAt: new Date().toISOString() };
  save([c, ...load()]);
  return c;
}

export function toggleInCrate(crateId: string, itemId: string): boolean {
  let added = false;
  save(
    load().map((c) => {
      if (c.id !== crateId) return c;
      added = !c.items.includes(itemId);
      return { ...c, items: added ? [itemId, ...c.items] : c.items.filter((i) => i !== itemId) };
    }),
  );
  return added;
}

export function deleteCrate(crateId: string) {
  save(load().filter((c) => c.id !== crateId));
}

/**
 * What a crate needs to show an entry that is not a loop row or a MIDI item (a preset, one-shot,
 * sample, kit or sound effect): its title, kind and the page it lives on. Kept beside the crates.
 */
export type CrateMeta = { title: string; kind: string; href: string; by?: string };
const META_KEY = "stash.demo.crate-meta";
let metaMemory: Record<string, CrateMeta> = {};

export function crateMeta(): Record<string, CrateMeta> {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (raw) return JSON.parse(raw) as Record<string, CrateMeta>;
  } catch {
    // Memory copy.
  }
  return metaMemory;
}

export function rememberMeta(itemId: string, meta: CrateMeta) {
  const next = { ...crateMeta(), [itemId]: meta };
  metaMemory = next;
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(next));
  } catch {
    // This visit only.
  }
}

export function useCrates(): Crate[] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  void v;
  return load();
}
