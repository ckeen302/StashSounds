"use client";

import { formatKey, type ItemRow } from "@stash/contracts";
import { useState, type ReactNode } from "react";
import { TagChip } from "./chip.tsx";
import { cx, transition, type PreviewState } from "./cx.ts";
import { Download, Ellipsis, Heart } from "./icon.tsx";
import { IconButton } from "./icon-button.tsx";
import { UiLink } from "./link.tsx";
import { ContextMenu, Menu, type MenuEntry } from "./menu.tsx";
import { PlayButton, type PlayState } from "./play-button.tsx";
import { SkeletonBlock } from "./skeleton.tsx";
import { Tooltip } from "./tooltip.tsx";
import { Waveform } from "./waveform.tsx";

/**
 * Column widths, shared by the header and every row so the numbers line up down the list.
 * Design spec: The result row. Waveform drops out on phone; tags and length drop out below desktop.
 */
const col = {
  play: "w-10 shrink-0",
  wave: "hidden w-50 shrink-0 tablet:block",
  title: "min-w-0 flex-1",
  tags: "hidden w-44 shrink-0 desktop:flex",
  key: "hidden w-14 shrink-0 tablet:block",
  bpm: "w-14 shrink-0 text-right",
  len: "hidden w-14 shrink-0 desktop:block",
  actions: "hidden w-24 shrink-0 justify-end tablet:flex",
};
const rowGrid = "flex items-center gap-4 px-3";

/** Engraved column labels over a list of rows. Visual only: each cell names itself to screen readers. */
export function ResultHeader({ className }: { className?: string }) {
  const label = "text-label text-label-caps text-text-muted";
  return (
    <div aria-hidden="true" className={cx(rowGrid, "h-8 border-b border-border", className)}>
      <span className={col.play} />
      <span className={cx(col.wave, label)}>Wave</span>
      <span className={cx(col.title, label)}>Title</span>
      <span className={cx(col.tags, label)}>Tags</span>
      <span className={cx(col.key, label)}>Key</span>
      <span className={cx(col.bpm, label)}>BPM</span>
      <span className={cx(col.len, label)}>Bars</span>
      <span className={col.actions} />
    </div>
  );
}

/** The panel that holds a header and rows. */
export function ResultList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-hidden rounded-panel border border-border bg-surface", className)}>
      <ResultHeader />
      <ul aria-label={label}>{children}</ul>
    </div>
  );
}

function lengthText(row: ItemRow): string {
  if (!row.length) return "";
  const { unit, value } = row.length;
  if (unit === "bars") return `${value} ${value === 1 ? "bar" : "bars"}`;
  if (unit === "samples") return `${value} smp`;
  return `${value.toFixed(1)}s`;
}

function describe(row: ItemRow): string {
  return ["Loop", lengthText(row), row.bpm ? `${row.bpm} BPM` : "", row.key ? formatKey(row.key) : ""].filter(Boolean).join(", ");
}

function LikeButton({ liked, title, onLike }: { liked: boolean; title: string; onLike?: (liked: boolean) => void }) {
  const [pulse, setPulse] = useState(false);
  return (
    <Tooltip content={liked ? "Unlike" : "Like"} shortcut="L">
      <IconButton
        icon={Heart}
        label={`Like ${title}`}
        on={liked}
        onClick={() => {
          if (!liked) setPulse(true);
          onLike?.(!liked);
        }}
        onAnimationEnd={() => setPulse(false)}
        className={cx("aria-pressed:*:fill-current", pulse && "*:animate-like")}
      />
    </Tooltip>
  );
}

export type ResultRowProps = PreviewState & {
  row: ItemRow;
  playState?: PlayState;
  /** Playback position from 0 to 1 while this row is the current item. */
  progress?: number;
  /** The keyboard selection: a 2 px accent bar on the left edge. */
  selected?: boolean;
  onPlay?: () => void;
  onScrub?: (fraction: number) => void;
  onLike?: (liked: boolean) => void;
  onDownload?: () => void;
  /** Entries for the more menu, the right-click menu and the long-press menu on phone. */
  menu?: MenuEntry[];
};

/**
 * One sound in a list, loop variant: play pad, mini waveform, title and handle, two tags, key, BPM,
 * bars, then like, download and more. 56 px tall on desktop, 64 on phone. The playing row lights its
 * play button over a faint raised background.
 */
export function ResultRow({
  row,
  playState = "paused",
  progress = 0,
  selected = false,
  onPlay,
  onScrub,
  onLike,
  onDownload,
  menu = [],
  ...preview
}: ResultRowProps) {
  const liked = row.viewer?.liked ?? false;
  const playing = playState === "playing";
  const keyText = row.key ? formatKey(row.key) : "";
  const content = (
    <li
      data-selected={selected || undefined}
      data-playing={playing || undefined}
      className={cx(
        "group relative h-16 border-b border-border last:border-b-0 tablet:h-14",
        rowGrid,
        transition,
        playing ? "bg-raised" : "bg-surface ui-hover:bg-raised",
        "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-transparent before:transition-colors before:duration-120",
        selected && "before:bg-accent",
      )}
      {...preview}
    >
      <div className={col.play}>
        <PlayButton title={row.title} state={playState} onClick={onPlay} />
      </div>
      <div className={col.wave}>
        <Waveform peaks={row.peaks} type={row.type} progress={progress} onScrub={onScrub} label={describe(row)} durationMs={row.durationMs} />
      </div>
      <div className={cx(col.title, "flex flex-col")}>
        <UiLink href={row.href} className="truncate rounded-control text-body-strong text-text ui-hover:underline">
          {row.title}
        </UiLink>
        <span className="truncate text-small text-text-muted">@{row.owner.handle}</span>
      </div>
      <div className={cx(col.tags, "gap-1 overflow-hidden")}>
        {row.tags.slice(0, 2).map((t) => (
          <TagChip key={t}>{t}</TagChip>
        ))}
      </div>
      <div className={cx(col.key, "font-mono text-numeric tabular text-text")}>
        <span className="sr-only">Key </span>
        {keyText || "—"}
      </div>
      <div className={cx(col.bpm, "flex flex-col font-mono text-numeric tabular text-text")}>
        <span>
          {row.bpm ?? "—"}
          <span className="sr-only"> BPM</span>
        </span>
        {/* Key merges with BPM on phone. */}
        {keyText && <span aria-hidden="true" className="text-text-muted tablet:hidden">{keyText}</span>}
      </div>
      <div className={cx(col.len, "font-mono text-numeric tabular text-text-muted")}>{lengthText(row)}</div>
      <div
        className={cx(
          col.actions,
          "items-center opacity-0 transition-opacity duration-control",
          "group-hover:opacity-100 group-focus-within:opacity-100 group-data-hover:opacity-100 group-data-selected:opacity-100 group-data-playing:opacity-100 pointer-coarse:opacity-100",
          liked && "opacity-100",
        )}
      >
        <LikeButton liked={liked} title={row.title} onLike={onLike} />
        <Tooltip content="Download" shortcut="D">
          <IconButton icon={Download} label={`Download ${row.title}`} onClick={onDownload} />
        </Tooltip>
        <Menu
          entries={menu}
          trigger={<IconButton icon={Ellipsis} label={`More for ${row.title}`} disabled={menu.length === 0} />}
        />
      </div>
    </li>
  );
  return menu.length > 0 ? <ContextMenu entries={menu}>{content}</ContextMenu> : content;
}

/** A row's exact footprint while the list loads. */
export function ResultRowSkeleton() {
  return (
    <li aria-hidden="true" className={cx(rowGrid, "h-16 border-b border-border bg-surface last:border-b-0 tablet:h-14")}>
      <div className={col.play}>
        <SkeletonBlock className="size-10" />
      </div>
      <div className={col.wave}>
        <SkeletonBlock className="h-2 w-full" />
      </div>
      <div className={cx(col.title, "flex flex-col gap-2")}>
        <SkeletonBlock className="h-3 w-40 max-w-full" />
        <SkeletonBlock className="h-3 w-20" />
      </div>
      <div className={cx(col.tags, "gap-1")}>
        <SkeletonBlock className="h-6 w-14" />
        <SkeletonBlock className="h-6 w-12" />
      </div>
      <div className={col.key}>
        <SkeletonBlock className="h-3 w-8" />
      </div>
      <div className={cx(col.bpm, "flex justify-end")}>
        <SkeletonBlock className="h-3 w-8" />
      </div>
      <div className={col.len}>
        <SkeletonBlock className="h-3 w-10" />
      </div>
      <div className={col.actions} />
    </li>
  );
}

/** A list's loading state: header and skeleton rows, announced once. */
export function ResultListSkeleton({ rows = 4, label = "Loading sounds" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="overflow-hidden rounded-panel border border-border bg-surface">
      <ResultHeader />
      <ul>
        {Array.from({ length: rows }, (_, i) => (
          <ResultRowSkeleton key={i} />
        ))}
      </ul>
    </div>
  );
}

