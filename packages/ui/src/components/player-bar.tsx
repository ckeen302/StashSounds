"use client";

import type { ItemRow } from "@stash/contracts";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { cx } from "./cx.ts";
import { useFrameLoop } from "./frame.ts";
import { SkipBack, SkipForward, Volume2, VolumeX } from "./icon.tsx";
import { IconButton } from "./icon-button.tsx";
import { PlayButton, type PlayState } from "./play-button.tsx";
import { Slider, volumeText } from "./slider.tsx";

/*
 * What is playing (title, waveform, readouts) and the phone sheet load on first use, from
 * player-details.tsx. They pull in the waveform and the contracts helpers, which the first paint
 * of an idle bar does not need (the script budget before audio, limits.performance).
 */
const PlayerDetails = lazy(() => import("./player-details.tsx").then((m) => ({ default: m.PlayerDetails })));
const LazySheet = lazy(() => import("./player-details.tsx").then((m) => ({ default: m.PlayerSheet })));

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
  /** The level unmute returns to when the caller remembers one (across a reload, say). */
  unmuteVolume?: number;
  /** The region's name; the gallery tells its specimens apart with it. */
  label?: string;
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

export const playState = (s: PlayerStatus): PlayState => (s === "idle" ? "paused" : s);
export const durationOf = (p: Pick<PlayerBarProps, "durationMs" | "item">) => (p.durationMs > 0 ? p.durationMs : (p.item?.durationMs ?? 0));

/** The 2 px progress line along the bar's top edge, on phone and tablet where there is no waveform. */
function ProgressLine({ getPositionMs, durationMs, running, lit }: { getPositionMs: () => number; durationMs: number; running: boolean; lit: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const frame = useCallback(() => {
    ref.current?.style.setProperty("--progress", String(playerFraction(getPositionMs(), durationMs)));
  }, [getPositionMs, durationMs]);
  useFrameLoop(frame, running);
  return (
    <span aria-hidden="true" data-player-progress="" className="absolute inset-x-0 top-0 h-0.5 bg-border desktop:hidden">
      <span ref={ref} className={cx("block h-full w-progress", lit ? "bg-accent" : "bg-text-muted")} />
    </span>
  );
}

export function Volume({ volume, onVolumeChange, unmuteVolume, className }: Pick<PlayerBarProps, "volume" | "onVolumeChange" | "unmuteVolume"> & { className?: string }) {
  // Mute remembers the level to come back to; a level the caller remembers wins.
  const [own, setRestore] = useState(volume > 0 ? volume : 0.8);
  const restore = unmuteVolume ?? own;
  const muted = volume === 0;
  return (
    // The caller sets the display (hidden on phone in the bar), so it is not set here to fight it.
    <div className={cx("items-center gap-2", className ?? "flex")}>
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
  const { item, status, getPositionMs, onPlayPause, onSeek, onPrevious, onNext, volume, onVolumeChange, unmuteVolume, onOpenSheet, label = "Player", className } = props;
  const durationMs = durationOf(props);
  const running = status === "playing";
  const idle = !item || status === "idle";
  const title = item?.title ?? "";

  return (
    <section
      aria-label={label}
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
        {/* A wrapper hides them on phone: a class on the button would lose to its own inline-flex. */}
        <span className="hidden tablet:contents">
          <IconButton icon={SkipBack} label="Previous" disabled={!onPrevious} onClick={onPrevious} />
        </span>
        <PlayButton title={idle ? "nothing loaded" : title} state={playState(status)} disabled={idle} onClick={onPlayPause} />
        <span className="hidden tablet:contents">
          <IconButton icon={SkipForward} label="Next" disabled={!onNext} onClick={onNext} />
        </span>
      </div>

      {idle ? (
        <p className="min-w-0 flex-1 truncate text-small text-text-muted">Nothing playing</p>
      ) : (
        <>
          <Suspense fallback={<div className="min-w-0 flex-1" />}>
            <PlayerDetails item={item} status={status} durationMs={durationMs} getPositionMs={getPositionMs} onSeek={onSeek} onOpenSheet={onOpenSheet} />
          </Suspense>
        </>
      )}

      <Volume volume={volume} onVolumeChange={onVolumeChange} unmuteVolume={unmuteVolume} className="hidden shrink-0 tablet:flex" />
    </section>
  );
}

export type PlayerSheetProps = Omit<PlayerBarProps, "onOpenSheet" | "className" | "item" | "label"> & {
  item: ItemRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Phone: the full-screen sheet, loaded the first time something plays (player-details.tsx). */
export function PlayerSheet(props: PlayerSheetProps) {
  return (
    <Suspense fallback={null}>
      <LazySheet {...props} />
    </Suspense>
  );
}
