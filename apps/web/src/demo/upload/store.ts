import { useSyncExternalStore } from "react";
import { deleteFile, putFile, type KitSound } from "../kits/store";

/**
 * Loops the viewer posts from the Upload tab. In the demo the audio stays in this browser's
 * IndexedDB (the kits' store) and the details in localStorage; nothing leaves the page.
 */

export type License = "royalty_free" | "credit_required";

export type PostedLoop = {
  id: string;
  title: string;
  bpm: number;
  key: string | null;
  tags: string[];
  license: License;
  durationMs: number;
  ext: string;
  postedAt: string;
};

const KEY = "stash.demo.loops.mine";
let memory: PostedLoop[] = [];
let version = 0;
const listeners = new Set<() => void>();

function load(): PostedLoop[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PostedLoop[];
  } catch {
    // Memory copy.
  }
  return memory;
}

function save(next: PostedLoop[]) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // This visit only.
  }
  version++;
  for (const l of listeners) l();
}

export function useMyLoops(): PostedLoop[] {
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

export async function postLoop(loop: Omit<PostedLoop, "id" | "postedAt">, data: ArrayBuffer): Promise<PostedLoop> {
  const id = `ul${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  await putFile(id, data);
  const row: PostedLoop = { ...loop, id, postedAt: new Date().toISOString() };
  save([row, ...load()]);
  return row;
}

export function removeLoop(id: string) {
  void deleteFile(id);
  save(load().filter((l) => l.id !== id));
}

/** The loop as something the kits' player can play. */
export function asSound(l: PostedLoop): KitSound {
  return { id: l.id, name: l.title, category: "other", durationMs: l.durationMs, fileKey: l.id };
}
