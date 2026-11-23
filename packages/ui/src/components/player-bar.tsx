"use client";

import { formatKey, type ItemRow } from "@stash/contracts";
import { Dialog as D } from "radix-ui";
import { useCallback, useRef, useState } from "react";
import { cx } from "./cx.ts";
import { useFrameLoop } from "./frame.ts";
import { ChevronDown, SkipBack, SkipForward, Volume2, VolumeX } from "./icon.tsx";
import { IconButton } from "./icon-button.tsx";
import { UiLink } from "./link.tsx";
import { PlayButton, type PlayState } from "./play-button.tsx";
import { describeRow } from "./result-row.tsx";
import { Slider, volumeText } from "./slider.tsx";
import { Waveform } from "./waveform.tsx";
import { formatTime } from "./waveform-bars.ts";

/** The engine's status (packages/audio EngineState["status"]). */
export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type PlayerBarProps = {
  /** The row that is playing, as the list that started it drew it. null when nothing is loaded. */
  item: ItemRow | null;
  status: PlayerStatus;
  /** The engine's duration; the row's own duration is used until the engine knows it. */
  durationMs: number;
  /** Read on every animation frame while playing (engine.getPositionMs). Position is not state. */
  getPositionMs: () => number;
  onPlayPause: () => void;
  /** Seek to a position in ms. Without it the waveform is a picture only. */
  onSeek?: (ms: number) => void;
  /** Undefined disables the control: there is no neighbour in the queue. */
  onPrevious?: () => void;
  onNext?: () => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  /** Phone: tapping the mini player opens the full sheet. */
  onOpenSheet?: () => void;
  className?: string;
};

/** What the player announces to screen readers: title, uploader and state (design spec, Accessibility). */
export function describePlayer(status: PlayerStatus, item: Pick<ItemRow, "title" | "owner"> | null): string {
  if (!item || status === "idle") return "Nothing playing";
  const what = `${item.title} by @${item.owner.handle}`;
  switch (status) {
    case "playing":
      return `Playing ${what}`;
    case "paused":
      return `Paused ${what}`;
    case "loading":
      return `Loading ${what}`;
    case "error":
      return `Could not play ${what}. Press play to retry.`;
  }
}

/** Position over duration, kept inside 0..1; 0 while either is unknown. */
export function playerFraction(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, positionMs / durationMs));
}

const playState = (s: PlayerStatus): PlayState => (s === "idle" ? "paused" : s);
const durationOf = (p: Pick<PlayerBarProps, "durationMs" | "item">) => (p.durationMs > 0 ? p.durationMs : (p.item?.durationMs ?? 0));

/** Elapsed time, written by the animation frame straight into the element. */
function Elapsed({ getPositionMs, durationMs, running }: { getPositionMs: () => number; durationMs: number; running: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const frame = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const text = formatTime(playerFraction(getPositionMs(), durationMs) * durationMs);
    if (el.textContent !== text) el.textContent = text;
  }, [getPositionMs, durationMs]);
  useFrameLoop(frame, running);
  return (
    <span ref={ref} data-player-elapsed="" className="font-mono text-numeric tabular text-text">
      0:00
    </span>
  );
}

/** The mini player's 2 px progress line along its top edge (phone). */
function ProgressLine({ getPositionMs, durationMs, running, lit }: { getPositionMs: () => number; durationMs: number; running: boolean; lit: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const frame = useCallback(() => {
    ref.current?.style.setProperty("--progress", String(playerFraction(getPositionMs(), durationMs)));
  }, [getPositionMs, durationMs]);
  useFrameLoop(frame, running);
  return (
    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-border tablet:hidden">
      <span ref={ref} className={cx("block h-full w-progress", lit ? "bg-accent" : "bg-text-muted")} />
    </span>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex w-14 flex-col">
      <span className="text-label text-label-caps text-text-muted">{label}</span>
      <span className="font-mono text-numeric tabular text-text">{value}</span>
    </span>
  );
}

function Volume({ volume, onVolumeChange, className }: Pick<PlayerBarProps, "volume" | "onVolumeChange"> & { className?: string }) {
  // Mute remembers the level to come back to.
  const [restore, setRestore] = useState(volume > 0 ? volume : 0.8);
  const muted = volume === 0;
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <IconButton
        icon={muted ? VolumeX : Volume2}
        label="Mute"
        on={muted}
        onClick={() => {
          if (muted) return onVolumeChange(restore > 0 ? restore : 0.8);
          setRestore(volume);
          onVolumeChange(0);
        }}
      />
      <Slider label="Volume" value={volume} onValueChange={onVolumeChange} valueText={volumeText} className="w-24" />
    </div>
  );
}

/**
 * The player, fixed below the content on every screen. One component draws the desktop bar (72 px),
 * the tablet bar (64 px) and the phone mini player (56 px): the transport, what is playing, the
 * waveform with elapsed and total time, BPM and KEY, and volume. Only the play button carries the
 * accent. The position is read from the engine in an animation frame, never from React state.
 */
export function PlayerBar(props: PlayerBarProps) {
  const { item, status, getPositionMs, onPlayPause, onSeek, onPrevious, onNext, volume, onVolumeChange, onOpenSheet, className } = props;
  const durationMs = durationOf(props);
  const running = status === "playing";
  const idle = !item || status === "idle";
  const getProgress = useCallback(() => playerFraction(getPositionMs(), durationMs), [getPositionMs, durationMs]);
  const title = item?.title ?? "";

  return (
    <section
      aria-label="Player"
      className={cx(
        "relative flex h-14 shrink-0 items-center gap-3 border-t border-border bg-surface px-3",
        "tablet:h-16 tablet:gap-4 tablet:px-4 desktop:h-18 desktop:gap-6 desktop:px-6",
        className,
      )}
    >
      <p aria-live="polite" className="sr-only">
        {describePlayer(status, item)}
      </p>
      {item && <ProgressLine getPositionMs={getPositionMs} durationMs={durationMs} running={running} lit={running} />}

      <div className="flex shrink-0 items-center gap-1">
        <IconButton icon={SkipBack} label="Previous" disabled={!onPrevious} onClick={onPrevious} className="hidden tablet:inline-flex" />
        <PlayButton title={idle ? "nothing loaded" : title} state={playState(status)} disabled={idle} onClick={onPlayPause} />
        <IconButton icon={SkipForward} label="Next" disabled={!onNext} onClick={onNext} className="hidden tablet:inline-flex" />
      </div>

      {idle ? (
        <p className="min-w-0 flex-1 truncate text-small text-text-muted">Nothing playing</p>
      ) : (
        <>
          {/* Phone: the whole text area opens the sheet. */}
          {onOpenSheet && (
            <button type="button" aria-label="Open player" onClick={onOpenSheet} className="flex min-w-0 flex-1 flex-col items-start rounded-control text-left tablet:hidden">
              <span className="w-full truncate text-body-strong text-text">{title}</span>
              <span className="w-full truncate text-small text-text-muted">@{item.owner.handle}</span>
            </button>
          )}
          <div className={cx("min-w-0 flex-1 flex-col", onOpenSheet ? "hidden tablet:flex" : "flex")}>
            <UiLink href={item.href} className="block truncate rounded-control text-body-strong text-text ui-hover:underline">
              {title}
            </UiLink>
            <UiLink href={`/u/${item.owner.handle}`} className="block truncate rounded-control text-small text-text-muted ui-hover:text-text">
              @{item.owner.handle}
            </UiLink>
          </div>

          <div className="hidden shrink-0 items-center gap-3 tablet:flex">
            <Elapsed getPositionMs={getPositionMs} durationMs={durationMs} running={running} />
            <Waveform
              peaks={item.peaks}
              type={item.type}
              getProgress={getProgress}
              playing={running}
              durationMs={durationMs}
              onScrub={onSeek && durationMs > 0 ? (f) => onSeek(f * durationMs) : undefined}
              label={describeRow(item)}
            />
            <span className="font-mono text-numeric tabular text-text-muted">{formatTime(durationMs)}</span>
          </div>

          <div className="hidden shrink-0 items-center gap-4 desktop:flex">
            <Readout label="BPM" value={item.bpm ? String(Math.round(item.bpm)) : "—"} />
            <Readout label="KEY" value={item.key ? formatKey(item.key) : "—"} />
          </div>
        </>
      )}

      <Volume volume={volume} onVolumeChange={onVolumeChange} className="hidden shrink-0 tablet:flex" />
    </section>
  );
}

export type PlayerSheetProps = Omit<PlayerBarProps, "onOpenSheet" | "className" | "item"> & {
  item: ItemRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Phone: the full-screen sheet the mini player opens. It slides up from the bottom and holds the
 * hero waveform with seek, the transport and volume. Escape or the close button lowers it and focus
 * goes back to the mini player.
 */
export function PlayerSheet(props: PlayerSheetProps) {
  const { item, status, getPositionMs, onPlayPause, onSeek, onPrevious, onNext, volume, onVolumeChange, open, onOpenChange } = props;
  const durationMs = durationOf(props);
  const running = status === "playing";
  const getProgress = useCallback(() => playerFraction(getPositionMs(), durationMs), [getPositionMs, durationMs]);
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Content
          aria-describedby={undefined}
          // No Radix trigger here (the mini player opens it), so remember what had focus and go back to it.
          onOpenAutoFocus={() => {
            returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnTo.current?.focus();
          }}
          className="fixed inset-0 z-40 flex animate-sheet flex-col gap-6 overflow-y-auto bg-bg px-3 pt-2 pb-8 outline-none"
        >
          <div className="flex items-center justify-between">
            <span className="text-label text-label-caps text-text-muted">Now playing</span>
            <D.Close asChild>
              <IconButton icon={ChevronDown} label="Close player" size="md" />
            </D.Close>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <D.Title className="truncate text-title text-text">{item.title}</D.Title>
            <UiLink href={`/u/${item.owner.handle}`} className="self-start rounded-control text-small text-text-muted">
              @{item.owner.handle}
            </UiLink>
          </div>
          <Waveform
            variant="hero"
            peaks={item.peaks}
            type={item.type}
            getProgress={getProgress}
            playing={running}
            durationMs={durationMs}
            onScrub={onSeek && durationMs > 0 ? (f) => onSeek(f * durationMs) : undefined}
            label={describeRow(item)}
          />
          <div className="flex justify-between">
            <Elapsed getPositionMs={getPositionMs} durationMs={durationMs} running={running} />
            <span className="font-mono text-numeric tabular text-text-muted">{formatTime(durationMs)}</span>
          </div>
          <div className="flex items-center justify-center gap-6">
            <IconButton icon={SkipBack} label="Previous" size="md" disabled={!onPrevious} onClick={onPrevious} />
            <PlayButton title={item.title} state={playState(status)} size="hero" onClick={onPlayPause} />
            <IconButton icon={SkipForward} label="Next" size="md" disabled={!onNext} onClick={onNext} />
          </div>
          <div className="flex justify-between gap-4">
            <Readout label="BPM" value={item.bpm ? String(Math.round(item.bpm)) : "—"} />
            <Readout label="KEY" value={item.key ? formatKey(item.key) : "—"} />
            <Volume volume={volume} onVolumeChange={onVolumeChange} className="flex-1 justify-end" />
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
