import { Button, Heart, IconButton, TextInput, Trash, formatCount } from "@stash/ui";
import { useEffect, useState, useSyncExternalStore } from "react";
import * as store from "./comments-store";
import { has, plays } from "./store";

/**
 * The social layer of the demo: comments on any sound (with replies, likes, names and timestamps),
 * and the trending order that decides what sits at the top of Home and Loops. Where comments are
 * kept is comments-store.ts: shared with everyone on the published page, this browser elsewhere.
 */

export type { Comment } from "./comments-store";

export function useSocialVersion(): number {
  useEffect(() => store.start(), []);
  return useSyncExternalStore(store.subscribe, store.getVersion, () => 0);
}

export function commentsOn(itemId: string) {
  return store.commentsOn(itemId);
}

export function commentCount(itemId: string): number {
  store.start();
  return store.commentsOn(itemId).length;
}

export const COMMENT_MAX = store.LIMITS.text;

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
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined });
}

const LIKE =
  "inline-flex h-8 items-center gap-1.5 rounded-control border border-border bg-raised px-2.5 font-mono text-numeric tabular text-text-muted ui-hover:border-border-strong ui-hover:text-text aria-pressed:border-accent aria-pressed:text-accent aria-pressed:*:fill-current";

/** The box that writes a comment or a reply. The name is asked once and remembered. */
function Composer({ itemId, parent, label, onDone, autoFocus = false }: { itemId: string; parent: string | null; label: string; onDone?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [name, setName] = useState(() => store.savedName());
  const [editName, setEditName] = useState(() => !store.savedName());
  const [trap, setTrap] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const left = COMMENT_MAX - text.length;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (trap) return; // A field people never see: only a bot fills it.
        setBusy(true);
        const problem = await store.post(itemId, text, name, parent);
        setBusy(false);
        if (problem) {
          setError(problem);
          if (!name.trim()) setEditName(true);
          return;
        }
        setError(undefined);
        setText("");
        setEditName(false);
        onDone?.();
      }}
    >
      {editName ? (
        <TextInput
          label="Name or handle"
          placeholder="e.g. @nightowlbeats"
          value={name}
          maxLength={store.LIMITS.name}
          autoComplete="nickname"
          size="sm"
          onChange={(e) => setName(e.target.value)}
         
        />
      ) : (
        <p className="text-small text-text-muted">
          {"Posting as "}
          <span className="text-text">{name}</span>
          {" · "}
          <button type="button" className="underline underline-offset-2 ui-hover:text-text" onClick={() => setEditName(true)}>
            Change
          </button>
        </p>
      )}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} className="sr-only" />
      <div className="flex items-start gap-2">
        <TextInput
          label={label}
          hideLabel
          placeholder={label}
          value={text}
          maxLength={COMMENT_MAX}
          autoFocus={autoFocus}
          error={error}
          hint={left < 80 ? `${left} characters left` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(undefined);
          }}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" disabled={busy || !text.trim()}>
          {parent ? "Reply" : "Post"}
        </Button>
      </div>
    </form>
  );
}

/** One comment: who, when, what, and its like, reply and delete controls. */
function CommentItem({ c, itemId, replies, canReply }: { c: store.Comment; itemId: string; replies?: store.Comment[]; canReply: boolean }) {
  const [replying, setReplying] = useState(false);
  const removable = c.mine || store.isModerator();
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-start gap-3 rounded-control border border-border bg-bg px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-small text-text-muted">
            <span className="text-text">{c.name}</span>
            {c.mine && " (you)"}
            {" · "}
            <time dateTime={c.at} title={new Date(c.at).toLocaleString("en")}>
              {ago(c.at)}
            </time>
          </span>
          <p className="text-small break-words whitespace-pre-line text-text">{c.text}</p>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" aria-pressed={c.liked} aria-label={`${c.liked ? "Unlike" : "Like"} ${c.name}'s comment, ${c.likes} likes`} onClick={() => void store.toggleLike(c.id)} className={LIKE}>
              <Heart className="size-4" aria-hidden="true" />
              {formatCount(c.likes)}
            </button>
            {canReply && (
              <Button size="sm" variant="ghost" aria-expanded={replying} onClick={() => setReplying(!replying)}>
                Reply
              </Button>
            )}
          </div>
        </div>
        {removable && <IconButton icon={Trash} label={c.mine ? "Delete your comment" : `Remove ${c.name}'s comment`} size="sm" onClick={() => void store.remove(c.id)} />}
      </div>
      {(replies?.length || replying) && (
        <div className="flex flex-col gap-2 border-l border-border pl-3 tablet:ml-3">
          {replies && replies.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label={`Replies to ${c.name}`}>
              {replies.map((r) => (
                <CommentItem key={r.id} c={r} itemId={itemId} canReply={false} />
              ))}
            </ul>
          )}
          {replying && <Composer itemId={itemId} parent={c.id} label={`Reply to ${c.name}`} autoFocus onDone={() => setReplying(false)} />}
        </div>
      )}
    </li>
  );
}

function where(mode: store.Mode): string {
  if (mode === "shared") return "Everyone who opens this demo sees these comments.";
  if (mode === "shared-readonly") return "You're seeing everyone's comments. Yours stay in this browser, because this link can't post for everyone.";
  if (mode === "loading") return "Loading comments.";
  return "In the demo your comments stay in this browser.";
}

/** The thread under a sound: what people said, oldest first, replies under each, and a box to add yours. */
export function Comments({ itemId, title, compact = false }: { itemId: string; title: string; compact?: boolean }) {
  useSocialVersion();
  const list = store.commentsOn(itemId);
  const keys = new Set(list.map((c) => c.id));
  // A reply whose comment was deleted moves up to the top level, so nothing said disappears.
  const top = list.filter((c) => !c.parent || !keys.has(c.parent));
  const replies = new Map<string, store.Comment[]>();
  for (const c of list) if (c.parent && keys.has(c.parent)) replies.set(c.parent, [...(replies.get(c.parent) ?? []), c]);
  return (
    <section aria-label={`Comments on ${title}`} className={compact ? "flex flex-col gap-3" : "flex flex-col gap-3 rounded-panel border border-border bg-surface p-4"}>
      {!compact && <h2 className="text-body-strong text-text">{list.length ? `Comments (${list.length})` : "Comments"}</h2>}
      {list.length === 0 ? (
        <p className="text-small text-text-muted">No comments yet. Say what you made with it, or what you&apos;d flip it into.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {top.map((c) => (
            <CommentItem key={c.id} c={c} itemId={itemId} replies={replies.get(c.id)} canReply />
          ))}
        </ul>
      )}
      <Composer itemId={itemId} parent={null} label="Add a comment" />
      <p className="text-small text-text-muted">
        {where(store.getMode())}
        {store.isStale() && store.getMode() !== "local" ? " Comments may be out of date." : ""}
      </p>
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

const TALK =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-border bg-raised px-2.5 font-mono text-numeric tabular text-text-muted ui-hover:border-border-strong ui-hover:text-text aria-expanded:border-border-strong aria-expanded:text-text";

/** The comment count on a list row; pressing it opens the row's thread under it. */
export function CommentToggle({ itemId, title, open, onToggle }: { itemId: string; title: string; open: boolean; onToggle: () => void }) {
  useSocialVersion();
  const n = commentCount(itemId);
  return (
    <button type="button" aria-expanded={open} aria-label={`Comments on ${title}, ${n}`} onClick={onToggle} className={TALK}>
      <CommentGlyph />
      {formatCount(n)}
    </button>
  );
}

/** A row's thread, as the list item right under the row. */
export function RowThread({ itemId, title }: { itemId: string; title: string }) {
  return (
    <li className="border-b border-border bg-bg px-3 py-3 last:border-b-0">
      <Comments itemId={itemId} title={title} compact />
    </li>
  );
}
