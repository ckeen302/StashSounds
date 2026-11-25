"use client";

import type { ItemRow } from "@stash/contracts";
import { formatKey } from "@stash/contracts/format";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { TagChip, TYPE_LABEL } from "./chip.tsx";
import { cx, transition, type PreviewState } from "./cx.ts";
import { Download, Ellipsis, Heart } from "./icon.tsx";
import { IconButton } from "./icon-button.tsx";
import { UiLink } from "./link.tsx";
import type { MenuEntry } from "./menu.tsx";
import { PlayButton, type PlayState } from "./play-button.tsx";
import { SkeletonBlock } from "./skeleton.tsx";
import { Tooltip } from "./tooltip.tsx";
import { Waveform } from "./waveform.tsx";

/**
 * Column widths, shared by the header and every row so the numbers line up down the list.
 * Design spec: The result row. Waveform drops out on phone; length drops out below desktop. Tags show
 * only when the list itself is at least 880 px wide (the list-wide container variant, PR #12 review):
 * at 1024 with the 232 px rail the list is about 744 wide and the title gets that room instead. Where
 * tags do show, only the chips that fit whole are drawn (they wrap into a clipped line).
 * On touch the three actions are 40 px each, so their cell grows to 120 and stays clear of the BPM.
 */
const col = {
  play: "w-10 shrink-0",
  wave: "hidden w-50 shrink-0 tablet:block",
  title: "min-w-24 flex-1",
  tags: "hidden h-6 w-44 min-w-0 flex-wrap items-center overflow-hidden list-wide:flex",
  key: "hidden w-14 shrink-0 tablet:block",
  bpm: "w-14 shrink-0 text-right",
  len: "hidden w-14 shrink-0 text-right desktop:block",
  actions: "hidden w-24 shrink-0 justify-end tablet:flex pointer-coarse:w-30",
};
// 12 px between columns: at 1024 with the 232 px rail the spec's columns plus a 96 px title just fit.
const rowGrid = "flex items-center gap-3 px-3";

/**
 * A zero-width first item in the tags cell. A wrapping line always keeps its first item, so without
 * it a chip wider than the cell would be cut; behind it, that chip wraps to the clipped second line.
 * The negative margin cancels the gap so the chips still start at the cell's edge.
 */
function TagSpacer() {
  return <span aria-hidden="true" className="-me-1 h-6 w-0" />;
}

/** Engraved column labels over a list of rows. Visual only: each cell names itself to screen readers. */
export function ResultHeader({ lengthLabel = "Bars", className }: { lengthLabel?: string; className?: string }) {
  const label = "text-label text-label-caps text-text-muted";
  return (
    <div aria-hidden="true" data-ui="result-header" className={cx(rowGrid, "h-8 border-b border-border", className)}>
      <span className={col.play} />
      <span className={cx(col.wave, label)}>Wave</span>
      <span className={cx(col.title, label)}>Title</span>
      <span className={cx(col.tags, label)}>Tags</span>
      <span className={cx(col.key, label)}>Key</span>
      <span className={cx(col.bpm, label)}>BPM</span>
      <span className={cx(col.len, label)}>{lengthLabel}</span>
      <span className={col.actions} />
    </div>
  );
}

/** The panel that holds a header and rows. */
export function ResultList({
  label,
  lengthLabel,
  children,
  className,
}: {
  label: string;
  /** The length column's engraved label: Bars for loops (the default), Len for mixed lists. */
  lengthLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("@container/result-list overflow-hidden rounded-panel border border-border bg-surface", className)} data-ui="result-list">
      <ResultHeader lengthLabel={lengthLabel} />
      <ul aria-label={label}>{children}</ul>
    </div>
  );
}

/** The length in words, for screen readers and the waveform's description: "4 bars". */
export function lengthText(row: Pick<ItemRow, "length">): string {
  if (!row.length) return "";
  const { unit, value } = row.length;
  if (unit === "bars") return `${value} ${value === 1 ? "bar" : "bars"}`;
  if (unit === "samples") return `${value} ${value === 1 ? "sample" : "samples"}`;
  return `${value.toFixed(1)} seconds`;
}

/** The length cell: bare bars under the BARS label; samples and seconds keep a short unit. */
function lengthCell(row: Pick<ItemRow, "length">): string {
  if (!row.length) return "";
  const { unit, value } = row.length;
  if (unit === "bars") return String(value);
  if (unit === "samples") return `${value} smp`;
  return `${value.toFixed(1)}s`;
}

/** "Loop, 4 bars, 140 BPM, Am": waveforms are described in text (design spec, Accessibility). */
export function describeRow(row: Pick<ItemRow, "type" | "length" | "bpm" | "key">): string {
  return [TYPE_LABEL[row.type], lengthText(row), row.bpm ? `${row.bpm} BPM` : "", row.key ? formatKey(row.key) : ""].filter(Boolean).join(", ");
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
      data-ui="result-row"
      data-selected={selected || undefined}
      data-playing={playing || undefined}
      className={cx(
        "group relative h-16 border-b border-border last:border-b-0 tablet:h-14",
        rowGrid,
        transition,
        playing ? "bg-raised" : "bg-surface ui-hover:bg-raised",
        "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:transition-colors before:duration-120",
        selected ? "before:bg-accent" : "before:bg-transparent",
      )}
      {...preview}
    >
      <div className={col.play}>
        <PlayButton title={row.title} state={playState} onClick={onPlay} />
      </div>
      <div className={col.wave}>
        <Waveform peaks={row.peaks} type={row.type} progress={progress} onScrub={onScrub} label={describeRow(row)} durationMs={row.durationMs} />
      </div>
      <div className={cx(col.title, "flex flex-col")}>
        {/* -my-3 py-3: a 44 px touch target that does not change the row's height. */}
        <UiLink href={row.href} className="-my-3 truncate rounded-control py-3 text-body-strong text-text ui-hover:underline">
          {row.title}
        </UiLink>
        <span className="truncate text-small text-text-muted">@{row.owner.handle}</span>
      </div>
      <div className={cx(col.tags, "gap-1")}>
        <TagSpacer />
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
      <div className={cx(col.len, "font-mono text-numeric tabular text-text-muted")}>
        <span aria-hidden="true">{lengthCell(row)}</span>
        <span className="sr-only">{lengthText(row)}</span>
      </div>
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
        {menu.length > 0 ? (
          <Suspense fallback={<IconButton icon={Ellipsis} label={`More for ${row.title}`} />}>
            <Menu entries={menu} trigger={<IconButton icon={Ellipsis} label={`More for ${row.title}`} />} />
          </Suspense>
        ) : (
          <IconButton icon={Ellipsis} label={`More for ${row.title}`} disabled />
        )}
      </div>
    </li>
  );
  return menu.length > 0 ? (
    <Suspense fallback={content}>
      <ContextMenu entries={menu}>{content}</ContextMenu>
    </Suspense>
  ) : (
    content
  );
}

// The menus (Radix Menu and ContextMenu, about 17 KB gzip) load only for rows that have entries, so a
// list without a menu stays inside the page script budget (ticket 135, the loop page).
const Menu = lazy(() => import("./menu.tsx").then((m) => ({ default: m.Menu })));
const ContextMenu = lazy(() => import("./menu.tsx").then((m) => ({ default: m.ContextMenu })));

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
        <TagSpacer />
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
    <div role="status" aria-label={label} className="@container/result-list overflow-hidden rounded-panel border border-border bg-surface">
      <ResultHeader />
      <ul>
        {Array.from({ length: rows }, (_, i) => (
          <ResultRowSkeleton key={i} />
        ))}
      </ul>
    </div>
  );
}

