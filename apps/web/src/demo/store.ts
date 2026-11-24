/**
 * Likes and follows in the demo: kept in this browser (localStorage), or for this visit when the
 * browser refuses storage. Nothing leaves the page.
 */
type Kind = "likes" | "follows" | "downloads";

const memory: Record<Kind, Set<string>> = { likes: new Set(), follows: new Set(), downloads: new Set() };
const KEY = (kind: Kind) => `stash.demo.${kind}`;

function load(kind: Kind): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY(kind));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Blocked or malformed: the memory copy stands.
  }
  return memory[kind];
}

export function has(kind: Kind, id: string): boolean {
  return load(kind).has(id);
}

export function set(kind: Kind, id: string, on: boolean) {
  const s = new Set(load(kind));
  if (on) s.add(id);
  else s.delete(id);
  memory[kind] = s;
  try {
    window.localStorage.setItem(KEY(kind), JSON.stringify([...s]));
  } catch {
    // Kept in memory above.
  }
}
