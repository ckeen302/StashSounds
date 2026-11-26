/**
 * Where the demo's comments live. The thread UI (social.tsx) reads one in-memory picture of every
 * comment and like, and writes only through `post`, `reply`, `toggleLike` and `remove`, so a real
 * backend replaces the two adapters below without touching the screens.
 *
 * Shape: one document per person, holding their name, every comment they wrote and every comment
 * they liked. Nobody writes anyone else's document, so two people can never overwrite each other,
 * and a like is counted once per person by construction.
 *
 * Adapters:
 *   - shared: the published page's `db` capability. Each viewer writes `comments/<their id>`; the
 *     access rules let everyone read every document and only the artifact's owner change another
 *     person's (to remove spam). Live: other people's comments arrive as they post.
 *   - local: this browser's storage. Used when the page runs anywhere without a database (a local
 *     build, a signed-out visitor) or the viewer is not allowed to write to it.
 *
 * Everything read from the shared store came from another browser: `clean` re-checks its shape and
 * limits before it reaches the screen, and React renders it as text.
 */

export const LIMITS = {
  text: 500,
  name: 30,
  /** Seconds between two posts from one person. */
  gapSeconds: 15,
  /** At most this many posts in the window below. */
  burst: 5,
  burstMinutes: 10,
  links: 1,
  /** Comments one person can have stored (keeps their document well under the store's size cap). */
  perPerson: 200,
} as const;

export type Post = { id: string; item: string; parent: string | null; text: string; at: string };
export type AuthorDoc = { name: string; posts: Record<string, Post>; likes: Record<string, string> };
export type Comment = Post & { author: string; name: string; likes: number; liked: boolean; mine: boolean };

export type Mode = "loading" | "shared" | "shared-readonly" | "local";

type Unsub = () => void;
type Snap = { id: string; data(): Record<string, unknown> | undefined };
type Db = {
  collection(path: string): {
    doc(id: string): { set(d: Record<string, unknown>): Promise<void> };
    onSnapshot(next: (s: { docs: Snap[]; metadata: { fromCache: boolean } }) => void, error?: (e: { code: string }) => void): Unsub;
  };
};
type User = { id(): Promise<string | null>; isOwner(): Promise<boolean>; can(name: string): Promise<boolean | null> };
type Host = { use?: (name: string) => Promise<unknown> };

const COLLECTION = "comments";
const LOCAL_KEY = "stash.demo.comments.v2";
const LEGACY_KEY = "stash.demo.comments";
const NAME_KEY = "stash.demo.comment-name";
const LOCAL_ME = "local";

// ---- state -------------------------------------------------------------------------------------

let mode: Mode = "loading";
let owner = false;
let stale = false;
let me = LOCAL_ME;
let shared = new Map<string, AuthorDoc>();
let mine: AuthorDoc = { name: "", posts: {}, likes: {} };
let version = 0;
let byItem = new Map<string, Comment[]>();
const listeners = new Set<() => void>();
let writeShared: ((doc: AuthorDoc, author?: string) => Promise<void>) | null = null;

function emit() {
  rebuild();
  version++;
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getVersion = () => version;
export const getMode = () => mode;
export const isModerator = () => owner;
/** True while the shared store has not answered (or stopped answering) for a while. */
export const isStale = () => stale;

// ---- validation --------------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_.:~-]{1,80}$/;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** A document from the store, checked field by field; anything malformed is dropped. */
export function clean(raw: Record<string, unknown> | undefined): AuthorDoc {
  const out: AuthorDoc = { name: "", posts: {}, likes: {} };
  if (!raw || typeof raw !== "object") return out;
  out.name = str(raw.name, LIMITS.name) ?? "";
  const posts = raw.posts && typeof raw.posts === "object" ? (raw.posts as Record<string, unknown>) : {};
  for (const [id, p] of Object.entries(posts).slice(0, LIMITS.perPerson)) {
    if (!ID.test(id) || !p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const item = str(r.item, 200);
    const text = str(r.text, LIMITS.text);
    const at = str(r.at, 40);
    const parent = r.parent === null || r.parent === undefined ? null : str(r.parent, 120);
    if (!item || !text || !at || Number.isNaN(Date.parse(at))) continue;
    if (parent !== null && !ID.test(parent.split("/").pop() ?? "")) continue;
    out.posts[id] = { id, item, parent, text, at };
  }
  const likes = raw.likes && typeof raw.likes === "object" ? (raw.likes as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(likes).slice(0, 2000)) if (k.length <= 120 && typeof v === "string") out.likes[k] = v;
  return out;
}

/** A comment's global key: its author and its id, so two people's ids can never collide. */
export const keyOf = (author: string, id: string) => `${author}/${id}`;

// ---- derived view ------------------------------------------------------------------------------

function authors(): [string, AuthorDoc][] {
  const list = [...shared.entries()].filter(([k]) => k !== me);
  list.push([me, mine]);
  return list;
}

function rebuild() {
  const all = authors();
  const likeCount = new Map<string, number>();
  for (const [, doc] of all) for (const k of Object.keys(doc.likes)) likeCount.set(k, (likeCount.get(k) ?? 0) + 1);
  const next = new Map<string, Comment[]>();
  for (const [author, doc] of all) {
    for (const p of Object.values(doc.posts)) {
      const key = keyOf(author, p.id);
      const c: Comment = { ...p, id: key, author, name: doc.name || "Producer", likes: likeCount.get(key) ?? 0, liked: key in mine.likes, mine: author === me };
      const list = next.get(p.item);
      if (list) list.push(c);
      else next.set(p.item, [c]);
    }
  }
  for (const list of next.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  byItem = next;
}

export function commentsOn(item: string): Comment[] {
  return byItem.get(item) ?? [];
}

// ---- spam and length checks --------------------------------------------------------------------

/** Why a comment cannot be posted, or null when it can. Pure, so it is tested on its own. */
export function problemWith(text: string, name: string, item: string, history: Post[], now: number): string | null {
  const t = text.trim();
  const n = name.trim();
  if (!n) return "Add a name or handle first.";
  if (n.length > LIMITS.name) return `Keep your name under ${LIMITS.name} characters.`;
  if (!t) return "Write something first.";
  if (t.length > LIMITS.text) return `Keep it under ${LIMITS.text} characters.`;
  if ((t.match(/https?:\/\/|www\./gi) ?? []).length > LIMITS.links) return "Only one link per comment.";
  if (/(.)\1{11,}/su.test(t)) return "That looks like a key held down. Try again with words.";
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 16 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.9) return "Easy on the caps.";
  const times = history.map((p) => Date.parse(p.at)).sort((a, b) => b - a);
  if (times[0] !== undefined && now - times[0] < LIMITS.gapSeconds * 1000) {
    const wait = Math.ceil((LIMITS.gapSeconds * 1000 - (now - times[0])) / 1000);
    return `Wait ${wait} s before posting again.`;
  }
  if (times.filter((x) => now - x < LIMITS.burstMinutes * 60_000).length >= LIMITS.burst) return "That's a lot of comments at once. Take a breather and come back in a few minutes.";
  const same = t.toLowerCase().replace(/\s+/g, " ");
  if (history.some((p) => p.item === item && p.text.toLowerCase().replace(/\s+/g, " ") === same)) return "You already posted that here.";
  if (history.length >= LIMITS.perPerson) return "You've hit the demo's comment limit. Delete an old one to post again.";
  return null;
}

// ---- writes ------------------------------------------------------------------------------------

let queue: Promise<void> = Promise.resolve();
/** Writes of my document not yet confirmed; while any are, a snapshot can't roll mine back. */
let pending = 0;

/** Writes my document: one write at a time, in order. */
function persist(): Promise<void> {
  const snapshot: AuthorDoc = JSON.parse(JSON.stringify(mine));
  const write = writeShared && mode === "shared" ? () => writeShared!(snapshot) : () => Promise.resolve(saveLocal(snapshot));
  pending++;
  const done = queue.then(write, write);
  queue = done.then(
    () => void pending--,
    () => void pending--,
  );
  return done;
}

function saveLocal(doc: AuthorDoc) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(doc));
  } catch {
    // This visit only.
  }
}

export function savedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? mine.name;
  } catch {
    return mine.name;
  }
}

function rid(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36).padStart(3, "0")}`;
}

/** Posts a comment (or a reply, with `parent` set to the top-level comment's key). */
export async function post(item: string, text: string, name: string, parent: string | null = null): Promise<string | null> {
  const problem = problemWith(text, name, item, Object.values(mine.posts), Date.now());
  if (problem) return problem;
  const n = name.trim();
  try {
    window.localStorage.setItem(NAME_KEY, n);
  } catch {
    // Not remembered.
  }
  const id = rid();
  mine = { ...mine, name: n, posts: { ...mine.posts, [id]: { id, item, parent, text: text.trim(), at: new Date().toISOString() } } };
  emit();
  try {
    await persist();
  } catch {
    return "That didn't save. Try again in a moment.";
  }
  return null;
}

export async function toggleLike(key: string): Promise<void> {
  const likes = { ...mine.likes };
  if (likes[key]) delete likes[key];
  else likes[key] = new Date().toISOString();
  mine = { ...mine, likes };
  emit();
  await persist().catch(() => undefined);
}

/** Deletes one of my comments, or (for the artifact's owner) anyone's. */
export async function remove(key: string): Promise<void> {
  const [author, id] = key.split("/") as [string, string];
  if (author === me) {
    const posts = { ...mine.posts };
    delete posts[id];
    mine = { ...mine, posts };
    emit();
    await persist().catch(() => undefined);
    return;
  }
  const doc = shared.get(author);
  if (!owner || !doc || !writeShared) return;
  const posts = { ...doc.posts };
  delete posts[id];
  const next = { ...doc, posts };
  shared.set(author, next);
  emit();
  await writeShared(next, author).catch(() => undefined);
}

// ---- start -------------------------------------------------------------------------------------

function loadLocal(): AuthorDoc {
  let doc: AuthorDoc = { name: "", posts: {}, likes: {} };
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (raw) doc = clean(JSON.parse(raw) as Record<string, unknown>);
    // Comments from before replies and names existed: carry them over once.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      for (const c of JSON.parse(legacy) as { id: string; itemId: string; body: string; at: string }[]) {
        const id = String(c.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 40) || rid();
        if (c.itemId && c.body && !doc.posts[id]) doc.posts[id] = { id, item: c.itemId, parent: null, text: String(c.body).slice(0, LIMITS.text), at: c.at };
      }
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(doc));
      window.localStorage.removeItem(LEGACY_KEY);
    }
    doc.name = window.localStorage.getItem(NAME_KEY) ?? doc.name;
  } catch {
    // Storage blocked: start empty.
  }
  return doc;
}

async function connect(): Promise<void> {
  const host = (globalThis as { claude?: Host }).claude;
  if (!host?.use) return void ((mode = "local"), emit());
  const [db, user] = (await Promise.all([host.use("db").catch(() => null), host.use("user").catch(() => null)])) as [Db | null, User | null];
  const uid = db && user ? await user.id().catch(() => null) : null;
  if (!db || !uid) return void ((mode = "local"), emit());
  owner = await user!.isOwner().catch(() => false);
  const canWrite = await user!.can("data.write").catch(() => null);
  const col = db.collection(COLLECTION);
  writeShared = (doc, author = uid) => col.doc(author).set(doc as unknown as Record<string, unknown>);
  const local = mine;
  let first = true;
  const timer = setTimeout(() => ((stale = true), emit()), 10_000);
  col.onSnapshot(
    (snap) => {
      const next = new Map<string, AuthorDoc>();
      for (const d of snap.docs) next.set(d.id, clean(d.data()));
      shared = next;
      if (!snap.metadata.fromCache) {
        clearTimeout(timer);
        stale = false;
      }
      if (first) {
        first = false;
        if (canWrite === false) {
          mode = "shared-readonly";
        } else {
          // Switch my comments to the shared store, bringing along any this browser kept.
          me = uid;
          const there = next.get(uid) ?? { name: "", posts: {}, likes: {} };
          const merged: AuthorDoc = { name: local.name || there.name, posts: { ...there.posts }, likes: { ...there.likes, ...local.likes } };
          let moved = false;
          for (const p of Object.values(local.posts)) {
            if (merged.posts[p.id]) continue;
            merged.posts[p.id] = p;
            moved = true;
          }
          mine = merged;
          mode = "shared";
          if (moved) {
            persist().then(
              () => saveLocal({ name: merged.name, posts: {}, likes: {} }),
              () => {
                // The store refused this viewer's write: stay on this browser.
                me = LOCAL_ME;
                mine = local;
                mode = "shared-readonly";
                emit();
              },
            );
          }
        }
      } else if (mode === "shared") {
        // Keep my own document as I last wrote it; the store echoes it back.
        const there = next.get(uid);
        if (there && pending === 0) mine = there;
      }
      emit();
    },
    () => {
      clearTimeout(timer);
      stale = true;
      if (mode === "loading") mode = "local";
      emit();
    },
  );
}

let started = false;
/** Loads this browser's copy, then tries the shared store. Safe to call more than once. */
export function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  mine = loadLocal();
  rebuild();
  void connect().catch(() => {
    mode = "local";
    emit();
  });
}
