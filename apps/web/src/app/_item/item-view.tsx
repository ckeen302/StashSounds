"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getEngine, usePlayerState } from "@stash/audio";
import type { ItemPage, ItemRow } from "@stash/contracts";
import { formatKey, LICENSE_LABELS as LICENSES } from "@stash/contracts/format";
import {
  Button,
  Download,
  formatTime,
  Heart,
  IconButton,
  LicenseBadge,
  Link as LinkIcon,
  PlayButton,
  ResultList,
  ResultRow,
  SEEK_STEP,
  Stat,
  TagChip,
  Tooltip,
  Transport,
  transposedKey,
  TypeChip,
  UiLink,
  UploaderCard,
  useToast,
  Waveform,
  type PlayState,
} from "@stash/ui";
import { nowPlaying } from "../_shell/now-playing";
import type { DownloadResult } from "./actions";
import { actionsFor } from "./actions-source";
import { itemKeyAction, keyInputFrom } from "./keys";
import type { ItemView as ItemViewData } from "./load-core";
import type { SignInIntent } from "./sign-in-dialog";
import { useItemPlayer } from "./use-item-player";

const SignInDialog = lazy(() => import("./sign-in-dialog"));
// Only after a download: the record and the code that saves the file (script budget, ticket 135).
const LicenseRecord = lazy(() => import("./download-record"));

/** After sign-in the visitor comes back with this, and the action they asked for completes. */
const INTENT = "then";
type Intent = SignInIntent;

/** An underlined link in running text, with a 40 px touch target (the ::after reaches 12 px above and below). */
const inlineLink = "relative rounded-control text-text underline decoration-border-strong underline-offset-4 ui-hover:decoration-text after:absolute after:inset-x-0 after:-inset-y-3";

const dateText = (iso: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

function describeSound(item: ItemPage["item"]): string {
  const bars = item.length?.unit === "bars" ? `${item.length.value} ${item.length.value === 1 ? "bar" : "bars"}` : null;
  return ["Loop", bars, item.bpm ? `${item.bpm} BPM` : null, item.key ? formatKey(item.key) : null].filter(Boolean).join(", ");
}

/**
 * The item page (design spec: Item page). Desktop: two columns, the left two thirds holding the title,
 * the hero player and the transport; the right the uploader card, the license with download and like,
 * and the metadata. Below both, more from this uploader. Phone: one column in the same order, with
 * download pinned above the mini player.
 */
export function ItemView({ view }: { view: ItemViewData }) {
  const { page, viewer, source } = view;
  const { item, owner } = page;
  const router = useRouter();
  const toast = useToast();
  const engine = getEngine();
  const actions = useMemo(() => actionsFor(source, page), [source, page]);

  // Likes and follows the visitor changed on this page (the server's answer, or the local one).
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [following, setFollowing] = useState(owner.viewerFollows);
  const [followers, setFollowers] = useState(owner.followersCount);
  const [followPending, setFollowPending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [record, setRecord] = useState<DownloadResult | null>(null);
  const [signIn, setSignIn] = useState<Intent | null>(null);

  const withState = useCallback((r: ItemRow): ItemRow => (r.id in liked ? { ...r, viewer: { liked: liked[r.id]! }, likesCount: likes[r.id] ?? r.likesCount } : r), [liked, likes]);
  const more = useMemo(() => page.moreFromOwner.map(withState), [page.moreFromOwner, withState]);
  const row = useMemo(() => withState(item), [item, withState]);
  const queue = useMemo(() => [row, ...more], [row, more]);
  const player = useItemPlayer(row, queue);
  const itemLiked = row.viewer?.liked ?? false;

  const ownerName = owner.displayName || owner.handle;
  const profileHref = `/u/${owner.handle}`;

  const download = async (target: ItemRow = row) => {
      if (!viewer.signedIn) return setSignIn("download");
      if (downloading) return;
      setDownloading(true);
      try {
        const r = await actions.download(target.id);
        if (!r.ok) return toast({ tone: "error", title: "Download did not start", description: r.message });
        const { saveFile } = await import("./download-record");
        await saveFile(actions.save, r.data.url, r.data.fileName);
        if (target.id === item.id) setRecord(r.data);
        toast({ tone: "success", title: `Downloading ${r.data.fileName}`, description: `${LICENSES[r.data.license].label} ${r.data.licenseVersion}. ${LICENSES[r.data.license].summary}` });
      } catch {
        toast({ tone: "error", title: "Download did not start", description: "Check your connection and try again." });
      } finally {
        setDownloading(false);
      }
  };

  const like = async (target: ItemRow, next: boolean) => {
      if (!viewer.signedIn) return setSignIn("like");
      if (!actions.like) return toast({ tone: "info", title: "Likes are not switched on yet", description: "They arrive with the next update." });
      setLiked((m) => ({ ...m, [target.id]: next }));
      const r = await actions.like(target.id, next);
      if (!r.ok) {
        setLiked((m) => ({ ...m, [target.id]: !next }));
        return toast({ tone: "error", title: "That like did not save", description: r.message });
      }
      setLiked((m) => ({ ...m, [target.id]: r.data.liked }));
      setLikes((m) => ({ ...m, [target.id]: r.data.likesCount }));
  };

  const follow = async (next: boolean) => {
      if (!viewer.signedIn) return setSignIn("follow");
      if (!actions.follow) return toast({ tone: "info", title: "Follows are not switched on yet", description: "They arrive with the next update." });
      setFollowPending(true);
      const r = await actions.follow(owner.id, next);
      setFollowPending(false);
      if (!r.ok) return toast({ tone: "error", title: "That follow did not save", description: r.message });
      setFollowing(r.data.following);
      setFollowers(r.data.followersCount);
      toast({ tone: "success", title: r.data.following ? `Following ${ownerName}` : `Unfollowed ${ownerName}` });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(item.href, window.location.origin).toString());
      toast({ tone: "success", title: "Link copied" });
    } catch {
      toast({ tone: "error", title: "Could not copy the link", description: "Copy it from the address bar instead." });
    }
  };

  // The latest handlers, for the window key listener and the sign-in return below.
  const handlers = () => ({
    player,
    like: () => like(row, !itemLiked),
    download: () => download(),
    likeOnce: () => (itemLiked ? undefined : like(row, true)),
    followOnce: () => (following ? undefined : follow(true)),
  });
  const keys = useRef(handlers());
  useEffect(() => {
    keys.current = handlers();
  });

  // Back from sign-in: `?then=` names the action, and it runs only if this tab's marker, set by
  // pressing Sign in in the dialog, matches this item. A bare link with `?then=` does nothing.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !viewer.signedIn) return;
    const url = new URL(window.location.href);
    const asked = url.searchParams.get(INTENT);
    if (!asked) return;
    resumed.current = true;
    url.searchParams.delete(INTENT);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // The marker code loads only on the way back from sign-in (script budget).
    void import("./intent").then(({ takeIntent, sessionStore }) => {
      const intent = takeIntent(sessionStore(), asked, item.id);
      if (!intent) return;
      // Through the same handlers the buttons use.
      const k = keys.current;
      if (intent === "download") void k.download();
      else if (intent === "like") void k.likeOnce();
      else if (intent === "follow") void k.followOnce();
    });
  }, [viewer.signedIn, item.id]);

  // The page's keys: space, arrows, [ ], - =, L, D.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector("[role=dialog]")) return;
      const action = itemKeyAction(keyInputFrom(e));
      if (!action) return;
      e.preventDefault();
      const { player: p, like: l, download: d } = keys.current;
      if (action === "toggle") p.toggle();
      else if (action === "seekBack") p.nudgeSeek(-SEEK_STEP);
      else if (action === "seekForward") p.nudgeSeek(SEEK_STEP);
      else if (action === "keyDown") p.nudgeKey(-1);
      else if (action === "keyUp") p.nudgeKey(1);
      else if (action === "tempoDown") p.nudgeTempo(-1);
      else if (action === "tempoUp") p.nudgeTempo(1);
      else if (action === "like") void l();
      else if (action === "download") void d();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // More from this uploader: rows play through the same engine, and the list is the queue.
  const status = usePlayerState((s) => s.status);
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const rowState = (r: ItemRow): PlayState => (r.playable.id !== currentId || status === "idle" ? "paused" : status === "loading" ? "loading" : status === "error" ? "error" : status === "playing" ? "playing" : "paused");

  const bars = item.length?.unit === "bars" ? item.length.value : null;
  // What the transport shows: the tempo and the shifted key the visitor hears.
  const liveBpm = player.tempo ? Math.round(player.tempo.bpm) : null;
  const liveKey = transposedKey(item.key, player.keyShift.semitones);
  const label = describeSound(item);
  const { summary } = LICENSES[item.license];
  const references = item.allTags.filter((t) => t.kind === "reference");
  const tags = item.allTags.filter((t) => t.kind !== "reference");
  const signInNext = (intent: Intent) => `/login?next=${encodeURIComponent(`${item.href}?${INTENT}=${intent}`)}`;

  const downloadButton = (side: "top" | "bottom") => (
    <Tooltip content={viewer.signedIn ? "Download with the license" : "Sign in to download"} shortcut="D" side={side}>
      <Button variant="primary" icon={Download} loading={downloading} onClick={() => void download()} className="flex-1">
        Download
      </Button>
    </Tooltip>
  );
  const likeButton = (
    <Tooltip content={itemLiked ? "Unlike" : "Like"} shortcut="L">
      <Button variant="secondary" icon={Heart} aria-pressed={itemLiked} onClick={() => void like(row, !itemLiked)} className="aria-pressed:*:fill-current">
        {itemLiked ? "Liked" : "Like"}
      </Button>
    </Tooltip>
  );

  return (
    <main aria-labelledby="item-title" className="@container mx-auto flex w-full max-w-content flex-col gap-8 px-3 pt-6 tablet:px-4 tablet:pb-8 desktop:px-6 desktop:pt-8">
      <div className="grid grid-cols-1 gap-6 cq-xl:grid-cols-3 cq-xl:gap-8">
        <div className="flex min-w-0 flex-col gap-6 cq-xl:col-span-2">
          <header className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-3">
              <TypeChip type={item.type} />
              <span className="text-small text-text-muted">Published {dateText(item.publishedAt)}</span>
            </div>
            <h1 id="item-title" className="text-display break-words text-text">
              {item.title}
            </h1>
            <p className="text-small text-text-muted">
              by{" "}
              <UiLink href={profileHref} className={inlineLink}>
                {ownerName}
              </UiLink>{" "}
              <span>@{owner.handle}</span>
            </p>
          </header>

          <section aria-label="Loop player" className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
            <div className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:gap-4">
              <div className="flex items-center gap-3">
                <PlayButton size="hero" title={item.title} state={player.playState} onClick={player.toggle} />
                {/* Phone: the facts beside the play pad, live with the tempo and key shift. */}
                <span className="flex flex-col tablet:hidden">
                  <span data-hero-facts className="font-mono text-numeric tabular text-text">
                    {[liveBpm ? `${liveBpm} BPM` : null, liveKey].filter(Boolean).join(" \u00b7 ")}
                  </span>
                  <span className="font-mono text-numeric tabular text-text-muted">{[bars ? `${bars} bars` : null, formatTime(player.durationMs)].filter(Boolean).join(" \u00b7 ")}</span>
                </span>
              </div>
              <Waveform
                variant="hero"
                type={item.type}
                peaks={item.peaks}
                durationMs={player.durationMs}
                bars={bars}
                playing={player.playing}
                getProgress={player.getProgress}
                onScrub={player.seek}
                label={label}
                className="min-w-0 flex-1"
              />
            </div>
            {/* Inside the card, so the page below does not move when it appears. */}
            {player.status === "error" && (
              <p role="alert" className="text-small text-type-kit">
                The preview did not load. Press play to try again.
              </p>
            )}
          </section>

          <Transport title={item.title} hints tempo={player.tempo} keyShift={player.keyShift} loop={player.loop} volume={player.volume} />

          {(item.description || tags.length > 0 || references.length > 0) && (
            <section aria-label="About" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
              {item.description && <p className="max-w-160 text-body text-text">{item.description}</p>}
              {(tags.length > 0 || references.length > 0) && (
                <ul aria-label="Tags" className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <li key={`t-${t.name}`}>
                      <TagChip>{t.name}</TagChip>
                    </li>
                  ))}
                  {references.map((t) => (
                    <li key={`r-${t.name}`}>
                      <TagChip>{`In the style of ${t.name}`}</TagChip>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <aside aria-label="Uploader and license" className="grid min-w-0 grid-cols-1 content-start gap-4 cq-md:grid-cols-2 cq-xl:grid-cols-1">
          <UploaderCard
            variant="full"
            owner={owner}
            href={profileHref}
            following={following}
            pending={followPending}
            onFollowChange={(f) => void follow(f)}
            followersCount={followers}
          />

          <section aria-labelledby="license-title" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="license-title" className="text-label text-label-caps text-text-muted">
                License
              </h2>
              <LicenseBadge kind={item.license} splitPercent={item.splitPercent} summaryTooltip={false} />
            </div>
            <p className="text-small text-text">
              {summary}
              {item.license === "split_on_placement" && item.splitPercent != null && ` The share is ${item.splitPercent} percent.`}
            </p>
            <p className="text-small text-text-muted">
              Version {item.licenseVersion}.{" "}
              <UiLink href="/licenses" className={inlineLink}>
                Read the full license
              </UiLink>
            </p>
            {record && (
              <Suspense fallback={null}>
                <LicenseRecord record={record} />
              </Suspense>
            )}
            {/* In the panel only where the panel is beside the player (the wide layout); narrower, the bar below. */}
            <div className="hidden gap-2 cq-xl:flex">
              {downloadButton("bottom")}
              {likeButton}
              <Tooltip content="Copy link">
                <IconButton icon={LinkIcon} label="Copy link" size="md" variant="pad" onClick={() => void copyLink()} />
              </Tooltip>
            </div>
          </section>

          <section aria-label="Details" className="grid grid-cols-3 gap-x-4 gap-y-4 rounded-panel cq-md:col-span-2 cq-md:grid-cols-6 cq-xl:col-span-1 cq-xl:grid-cols-3 border border-border bg-surface p-4">
            <Stat label="BPM" value={item.bpm ?? "—"} />
            <Stat label="Key" value={item.key ? formatKey(item.key) : "—"} />
            <Stat label="Bars" value={bars ?? "—"} />
            <Stat label="Len" value={item.durationMs ? formatTime(item.durationMs) : "—"} />
            <Stat label="Likes" value={row.likesCount} />
            <Stat label="Downloads" value={item.downloadsCount} />
            {item.genre && <Stat label="Genre" value={item.genre} className="col-span-3 cq-md:col-span-1 cq-xl:col-span-3" />}
          </section>
        </aside>
      </div>

      {more.length > 0 && (
        <section aria-labelledby="more-title" className="flex flex-col gap-3">
          <h2 id="more-title" className="text-title text-text">
            More from {ownerName}
          </h2>
          <ResultList label={`More from ${ownerName}`}>
            {more.map((r, i) => (
              <ResultRow
                key={r.id}
                row={r}
                playState={rowState(r)}
                onPlay={() => void nowPlaying().playFrom(engine, more, i)}
                onLike={(l) => void like(r, l)}
                onDownload={() => void download(r)}
              />
            ))}
          </ResultList>
        </section>
      )}

      {/* Until the wide layout, download is pinned to the bottom of the view (above the mini player on a
          phone), so it is on screen without scrolling at every width. Sticky at the end of the content. */}
      <div
        data-download-bar
        className="sticky bottom-0 -mx-3 flex items-center gap-2 border-t border-border bg-bg px-3 py-2 tablet:-mx-4 tablet:px-4 desktop:-mx-6 desktop:px-6 cq-xl:hidden"
      >
        <span className="flex min-w-0 shrink flex-col">
          <span className="sr-only">License: </span>
          <span className="truncate text-label text-label-caps text-text">{LICENSES[item.license].label}</span>
        </span>
        <span className="flex flex-1 justify-end gap-2 cq-md:flex-none">
          {downloadButton("top")}
          {likeButton}
        </span>
      </div>

      {signIn && (
        <Suspense fallback={null}>
          <SignInDialog intent={signIn} itemId={item.id} ownerName={ownerName} onClose={() => setSignIn(null)} onSignIn={() => router.push(signInNext(signIn))} />
        </Suspense>
      )}
    </main>
  );
}
