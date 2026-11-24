"use client";

import { decodePeaks, type ItemRow, type ItemType } from "@stash/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { color, typeColor, WAVEFORM_UNPLAYED_OPACITY } from "../tokens.ts";
import type {} from "./css-vars.ts";
import { cx } from "./cx.ts";
import { useFrameLoop } from "./frame.ts";
import {
  barHeight,
  barLayout,
  barValues,
  clamp01,
  formatTime,
  fractionAt,
  loudness,
  seekFromKey,
  WAVEFORM_GEOMETRY,
  type WaveformVariant,
} from "./waveform-bars.ts";

/** Base64 peak bytes as contracts' peaksSchema validates them. */
export type Peaks = NonNullable<ItemRow["peaks"]>;

export type WaveformProps = {
  /** 800 peak bytes, base64 (contracts peaksSchema). null while they are not known yet. */
  peaks: Peaks | null;
  type: ItemType;
  variant?: WaveformVariant;
  /** Playback position from 0 to 1. The color change is the playhead. */
  progress?: number;
  /**
   * Reads the position (0 to 1) on every animation frame while `playing`, instead of `progress`.
   * The player passes the engine's clock here so position never becomes React state.
   */
  getProgress?: () => number;
  /** Hero only: shows the accent playhead and its time. */
  playing?: boolean;
  /** The peaks could not be read. */
  error?: boolean;
  /** For the time labels on the hero. */
  durationMs?: number | null;
  /** Hero only: loop length in bars, drawn as faint ticks along the bottom. */
  bars?: number | null;
  /** Seek to a fraction of the length. Without it the waveform is a picture only. */
  onScrub?: (fraction: number) => void;
  /** Text description: "Loop, 4 bars, 90 BPM, D minor". Waveforms are described in text. */
  label: string;
  /** Gallery only: freeze the pointer's ghost line at this fraction, as if hovering or scrubbing. */
  pointer?: number;
  className?: string;
};

/** Bars at uniform low height before the peaks arrive (design spec: Loading). */
const LOADING_VALUE = 0.125;

function useCanvasSize(ref: RefObject<HTMLCanvasElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight, dpr: window.devicePixelRatio || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * The sound as the image. Vertical bars mirrored around the centre line, in the type color: 35
 * percent before the playhead passes, full strength after. Mini is 200 by 32 in rows; hero is the
 * column width by 120 (88 on phone). Drawn on canvas at the screen's pixel density; the bar values
 * are computed once per size and only the paint repeats as the position moves.
 */
export function Waveform({
  peaks,
  type,
  variant = "mini",
  progress: rawProgress = 0,
  getProgress,
  playing = false,
  error = false,
  durationMs,
  bars,
  onScrub,
  label,
  pointer: pointerPreview,
  className,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height, dpr } = useCanvasSize(canvasRef);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const hero = variant === "hero";
  const progress = clamp01(getProgress ? 0 : rawProgress);
  const sliderRef = useRef<HTMLDivElement>(null);
  const clockLabelRef = useRef<HTMLSpanElement>(null);
  const pointer = pointerPreview === undefined ? hoverAt : clamp01(pointerPreview);

  const decoded = useMemo(() => {
    if (!peaks) return null;
    try {
      return decodePeaks(peaks);
    } catch {
      return null;
    }
  }, [peaks]);
  const layout = useMemo(() => barLayout(width, variant), [width, variant]);
  const values = useMemo(() => {
    if (error) return new Float32Array(layout.count);
    if (!decoded) return new Float32Array(layout.count).fill(LOADING_VALUE);
    return barValues(decoded, layout.count).map(loudness);
  }, [decoded, error, layout.count]);

  const paint = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || width === 0 || height === 0) return;
    const w = Math.round(width * dpr);
    const hgt = Math.round(height * dpr);
    // Resizing a canvas reallocates it; do it only when the size changes, not every frame.
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { bar } = WAVEFORM_GEOMETRY[variant];
    const hue = error ? color["border-strong"] : typeColor[type];
    const playedX = progress * width;
    // Loop markers: bar lines as faint ticks along the bottom (hero only).
    if (hero && bars && bars > 1 && !error) {
      ctx.fillStyle = color["border-strong"];
      for (let i = 1; i < bars; i++) ctx.fillRect(Math.round((i / bars) * width), height - 4, 1, 4);
    }
    ctx.fillStyle = hue;
    // A hero that failed shows its message alone; the mini keeps a flat line so the row holds its shape.
    const barCount = hero && error ? 0 : layout.count;
    for (let i = 0; i < barCount; i++) {
      const x = layout.offset + i * layout.step;
      const h = barHeight(values[i]!, hero ? height - 8 : height);
      const y = Math.round((height - h) / 2);
      ctx.globalAlpha = !error && decoded && x + bar / 2 <= playedX ? 1 : WAVEFORM_UNPLAYED_OPACITY;
      ctx.beginPath();
      ctx.roundRect(x, y, bar, h, bar / 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Ghost line where the pointer is (scrub position).
    if (pointer !== null && !error) {
      ctx.fillStyle = color["text-muted"];
      ctx.fillRect(Math.round(pointer * width), 0, 1, height);
    }
    // Hero playhead: 1 px accent line. The mini has none; its color change is the playhead.
    if (hero && (playing || progress > 0) && !error) {
      ctx.fillStyle = color.accent;
      ctx.fillRect(Math.min(width - 1, Math.round(playedX)), 0, 1, height);
    }
  }, [width, height, dpr, layout, values, decoded, playing, pointer, error, hero, bars, type, variant]);

  const ms = durationMs && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const frame = useCallback(() => {
    if (!getProgress) return paint(progress);
    const p = clamp01(getProgress());
    paint(p);
    // The hero's time above the playhead follows the clock too, written straight to the element.
    const label = clockLabelRef.current;
    if (label) {
      const shown = (playing || p > 0) && ms > 0;
      label.hidden = !shown;
      if (shown) {
        label.style.setProperty("--playhead", String(p));
        label.textContent = formatTime(p * ms);
        label.classList.toggle("-translate-x-1/2", p >= 0.08 && p <= 0.92);
        label.classList.toggle("-translate-x-full", p > 0.92);
      }
    }
    // The slider's value follows the clock too, written straight to the element.
    const el = sliderRef.current;
    if (el?.getAttribute("role") === "slider") {
      const now = String(Math.round(p * 100));
      if (el.getAttribute("aria-valuenow") !== now) {
        el.setAttribute("aria-valuenow", now);
        if (ms > 0) el.setAttribute("aria-valuetext", `${formatTime(p * ms)} of ${formatTime(ms)}`);
      }
    }
  }, [getProgress, paint, progress, ms, playing]);
  useFrameLoop(frame, Boolean(getProgress) && playing);

  const fromEvent = useCallback((e: PointerEvent<HTMLElement>) => fractionAt(e.clientX - e.currentTarget.getBoundingClientRect().left, e.currentTarget.clientWidth), []);
  const interactive = Boolean(onScrub) && !error;

  const scrub = (f: number) => {
    onScrub?.(f);
    // With a clock reader, show the new position at once even while paused.
    if (getProgress) frame();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const now = getProgress ? clamp01(getProgress()) : progress;
    const next = onScrub ? seekFromKey(e.key, now, e.shiftKey) : null;
    if (next === null) return;
    e.preventDefault();
    scrub(next);
  };

  const timeAt = (f: number) => formatTime(f * ms);
  const edge = (f: number) => (f < 0.08 ? "translate-x-0" : f > 0.92 ? "-translate-x-full" : "-translate-x-1/2");
  const showPlayhead = hero && !getProgress && (playing || progress > 0) && !error && ms > 0;
  // With a clock reader the label is written per frame (see frame above), never through React state.
  const clockLabel = hero && Boolean(getProgress) && !error && ms > 0;

  return (
    <div className={cx("relative flex min-w-0 flex-col", hero ? "gap-1" : "", className)}>
      {hero && (
        <div className="relative h-5" aria-hidden="true">
          {showPlayhead && (
            <span style={{ "--playhead": progress }} className={cx("absolute top-0 left-playhead font-mono text-numeric tabular text-accent", edge(progress))}>
              {timeAt(progress)}
            </span>
          )}
          {clockLabel && (
            <span ref={clockLabelRef} hidden data-playhead-time className="absolute top-0 left-playhead font-mono text-numeric tabular text-accent" />
          )}
          {pointer !== null && !error && ms > 0 && (
            <span style={{ "--pointer": pointer }} className={cx("absolute top-0 left-pointer rounded-control bg-raised px-1 font-mono text-numeric tabular text-text-muted", edge(pointer))}>
              {timeAt(pointer)}
            </span>
          )}
        </div>
      )}
      <div
        ref={sliderRef}
        role={interactive && hero ? "slider" : "img"}
        aria-label={interactive && hero ? `Seek, ${label}` : label}
        aria-valuemin={interactive && hero ? 0 : undefined}
        aria-valuemax={interactive && hero ? 100 : undefined}
        aria-valuenow={interactive && hero ? Math.round(progress * 100) : undefined}
        aria-valuetext={interactive && hero && ms > 0 ? `${timeAt(progress)} of ${formatTime(ms)}` : undefined}
        tabIndex={interactive && hero ? 0 : undefined}
        data-scrubbing={scrubbing || undefined}
        onKeyDown={interactive && hero ? onKeyDown : undefined}
        onPointerMove={interactive ? (e) => {
          const f = fromEvent(e);
          setHoverAt(f);
          if (scrubbing) scrub(f);
        } : undefined}
        onPointerLeave={interactive ? () => !scrubbing && setHoverAt(null) : undefined}
        onPointerDown={interactive ? (e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setScrubbing(true);
          scrub(fromEvent(e));
        } : undefined}
        onPointerUp={interactive ? (e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setScrubbing(false);
        } : undefined}
        className={cx(
          "relative rounded-control",
          hero ? "h-22 tablet:h-30" : "h-8 w-50",
          interactive && "cursor-pointer touch-none",
          interactive && !hero && "transition duration-control hover:brightness-125",
        )}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="block size-full" />
        {error && hero && (
          <span className="absolute inset-0 flex items-center justify-center text-small text-text-muted">Waveform unavailable. Play still works.</span>
        )}
      </div>
    </div>
  );
}
