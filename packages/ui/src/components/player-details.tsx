"use client";

import { formatKey, type ItemRow } from "@stash/contracts";
import { Dialog as D } from "radix-ui";
import { useCallback, useRef, type ReactNode } from "react";
import { cx } from "./cx.ts";
import { useFrameLoop } from "./frame.ts";
import { ChevronDown, SkipBack, SkipForward } from "./icon.tsx";
import { IconButton } from "./icon-button.tsx";
import { UiLink } from "./link.tsx";
import { PlayButton } from "./play-button.tsx";
import { durationOf, playerFraction, playState, Volume, type PlayerBarProps, type PlayerSheetProps } from "./player-bar.tsx";
import { describeRow } from "./result-row.tsx";
import { Waveform } from "./waveform.tsx";
import { formatTime } from "./waveform-bars.ts";

/**
 * The parts of the player that need a loaded item: the title and handle, the desktop waveform with
 * its times, the readouts, and the phone sheet. Split from player-bar.tsx so an idle bar's first
 * paint does not carry them (PlayerBar and PlayerSheet load this file lazily).
 */

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

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex w-14 flex-col">
      <span className="text-label text-label-caps text-text-muted">{label}</span>
      <span className="font-mono text-numeric tabular text-text">{value}</span>
    </span>
  );
}

/** The loaded bar's middle: what is playing, the desktop waveform and the readouts. */
export function PlayerDetails({
  item,
  status,
  durationMs,
  getPositionMs,
  onSeek,
  onOpenSheet,
}: Pick<PlayerBarProps, "status" | "getPositionMs" | "onSeek" | "onOpenSheet"> & { item: ItemRow; durationMs: number }) {
  const running = status === "playing";
  const getProgress = useCallback(() => playerFraction(getPositionMs(), durationMs), [getPositionMs, durationMs]);
  const title = item.title;
  return (
    <>
          {/* Phone: the whole text area opens the sheet. */}
          {onOpenSheet && (
            <button
              type="button"
              aria-label="Open player"
              onClick={onOpenSheet}
              className="flex h-10 min-w-0 flex-1 flex-col items-start justify-center rounded-control text-left tablet:hidden"
            >
              <span className="w-full truncate text-body-strong text-text">{title}</span>
              <span className="w-full truncate text-small text-text-muted">@{item.owner.handle}</span>
            </button>
          )}
          {/*
            The title never shrinks below 128 px; at 1024 with everything shown it keeps about 160.
            Tablet: title and handle share one line so each is a 40 px tap target inside the 64 px bar.
          */}
          <div
            className={cx(
              "min-w-32 flex-1 items-center gap-2 desktop:flex-col desktop:items-start desktop:gap-0",
              onOpenSheet ? "hidden tablet:flex" : "flex",
            )}
          >
            <UiLink
              href={item.href}
              className="flex h-10 min-w-0 items-center rounded-control text-body-strong text-text ui-hover:underline desktop:block desktop:h-auto desktop:max-w-full"
            >
              <span className="block min-w-0 truncate">{title}</span>
            </UiLink>
            <UiLink
              href={`/u/${item.owner.handle}`}
              className="flex h-10 max-w-40 shrink-0 items-center rounded-control text-small text-text-muted ui-hover:text-text desktop:block desktop:h-auto desktop:max-w-full"
            >
              <span className="block min-w-0 truncate">@{item.owner.handle}</span>
            </UiLink>
          </div>

          {/* Desktop only: a tablet bar keeps the transport, the title and volume. */}
          <div className="hidden shrink-0 items-center gap-3 desktop:flex">
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
  );
}

/**
 * Phone: the full-screen sheet the mini player opens. It slides up from the bottom and holds the
 * hero waveform with seek, the transport and volume. Escape or the close button lowers it and focus
 * goes back to the mini player.
 */
export function PlayerSheet(props: PlayerSheetProps) {
  const { open, onOpenChange, ...controls } = props;
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
          className="fixed inset-0 z-40 animate-sheet overflow-y-auto bg-bg outline-none"
        >
          <SheetBody
            {...controls}
            title={<D.Title className="line-clamp-2 text-title text-text">{controls.item.title}</D.Title>}
            close={
              <D.Close asChild>
                <IconButton icon={ChevronDown} label="Close player" size="md" />
              </D.Close>
            }
          />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The gallery's frozen picture of the phone sheet, drawn in place instead of over the page. */
export function PlayerSheetPreview(props: Omit<PlayerSheetProps, "open" | "onOpenChange">) {
  return (
    <div inert className="w-full max-w-95 rounded-panel border border-border bg-bg">
      <SheetBody
        {...props}
        title={<p className="line-clamp-2 text-title text-text">{props.item.title}</p>}
        close={<IconButton icon={ChevronDown} label="Close player" size="md" />}
      />
    </div>
  );
}

function SheetBody(props: Omit<PlayerSheetProps, "open" | "onOpenChange"> & { title: ReactNode; close: ReactNode }) {
  const { item, status, getPositionMs, onPlayPause, onSeek, onPrevious, onNext, volume, onVolumeChange, unmuteVolume, title, close } = props;
  const durationMs = durationOf(props);
  const running = status === "playing";
  const getProgress = useCallback(() => playerFraction(getPositionMs(), durationMs), [getPositionMs, durationMs]);
  return (
    <div className="flex flex-col gap-6 px-3 pt-2 pb-8">
      <div className="flex items-center justify-between">
        <span className="text-label text-label-caps text-text-muted">Now playing</span>
        {close}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {title}
        <UiLink href={`/u/${item.owner.handle}`} className="inline-flex h-10 items-center self-start rounded-control text-small text-text-muted">
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
        <Volume volume={volume} onVolumeChange={onVolumeChange} unmuteVolume={unmuteVolume} className="flex flex-1 justify-end" />
      </div>
    </div>
  );
}
