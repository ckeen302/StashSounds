import { Button, TextInput, Trash, IconButton } from "@stash/ui";
import { useState, useSyncExternalStore } from "react";
import { has, plays } from "./store";

/**
 * The social layer of the demo: comments on any sound, and the trending order that decides what
 * sits at the top of Home and Loops. Comments are kept in this browser; nothing leaves the page.
 */

export type Comment = { id: string; itemId: string; body: string; at: string };

const KEY = "stash.demo.comments";
let memory: Comment[] = [];
let version = 0;
const listeners = new Set<() => void>();

function load(): Comment[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Comment[];
  } catch {
    // Memory copy.
  }
  return memory;
}

function save(next: Comment[]) {
  memory = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // This visit only.
  }
  version++;
  for (const l of listeners) l();
}

export function useSocialVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}

export function commentsOn(itemId: string): Comment[] {
  return load().filter((c) => c.itemId === itemId);
}

export function commentCount(itemId: string): number {
  return commentsOn(itemId).length;
}

export const COMMENT_MAX = 500;

export function addComment(itemId: string, body: string) {
  const text = body.trim().slice(0, COMMENT_MAX);
  if (!text) return;
  save([...load(), { id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, itemId, body: text, at: new Date().toISOString() }]);
}

export function removeComment(id: string) {
  save(load().filter((c) => c.id !== id));
}

/**
 * Trending, the way a social feed ranks: engagement over age with gravity, so a fresh sound with a
 * few likes beats an old one with many. Downloads count most (the producer took it home), then
 * comments, likes and plays; sounds from producers you follow get a lift.
 *   score = (1 + plays + 2·likes + 4·comments + 5·downloads) × (followed ? 1.5 : 1) / (hours + 2)^1.4
 */
export function trendScore(
  s: { id: string; ownerId: string; publishedAt: string; likes: number; downloads: number },
  now: number,
): number {
  const hours = Math.max(0, (now - Date.parse(s.publishedAt)) / 3_600_000);
  const engagement = 1 + plays(s.id) + 2 * s.likes + 4 * commentCount(s.id) + 5 * s.downloads;
  const followed = has("follows", s.ownerId) ? 1.5 : 1;
  return (engagement * followed) / (hours + 2) ** 1.4;
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** The thread under a sound: what people said, newest last, and a box to add yours. */
export function Comments({ itemId, title, compact = false }: { itemId: string; title: string; compact?: boolean }) {
  useSocialVersion();
  const list = commentsOn(itemId);
  const [text, setText] = useState("");
  const left = COMMENT_MAX - text.length;
  return (
    <section aria-label={`Comments on ${title}`} className={compact ? "flex flex-col gap-3" : "flex flex-col gap-3 rounded-panel border border-border bg-surface p-4"}>
      {!compact && <h2 className="text-body-strong text-text">{list.length ? `Comments (${list.length})` : "Comments"}</h2>}
      {list.length === 0 ? (
        <p className="text-small text-text-muted">No comments yet. Say what you made with it, or what you&apos;d flip it into.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((c) => (
            <li key={c.id} className="flex items-start gap-3 rounded-control border border-border bg-bg px-3 py-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-small text-text-muted">
                  <span className="text-text">You</span> · {ago(c.at)}
                </span>
                <p className="text-small break-words text-text">{c.body}</p>
              </div>
              <IconButton icon={Trash} label="Delete your comment" size="sm" onClick={() => removeComment(c.id)} />
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          addComment(itemId, text);
          setText("");
        }}
      >
        <TextInput
          label="Add a comment"
          hideLabel
          placeholder="Add a comment"
          value={text}
          maxLength={COMMENT_MAX}
          hint={left < 80 ? `${left} characters left` : undefined}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={!text.trim()}>
          Post
        </Button>
      </form>
      <p className="text-small text-text-muted">In the demo your comments stay in this browser.</p>
    </section>
  );
}

/** A speech bubble, drawn like the interface's other icons (24 grid, 2 px stroke, current colour). */
export function CommentGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}
