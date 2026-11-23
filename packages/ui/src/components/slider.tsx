"use client";

import { Slider as S } from "radix-ui";
import { useState } from "react";
import { cx, type PreviewState } from "./cx.ts";

export type SliderProps = PreviewState & {
  /** The accessible name: "Volume". */
  label: string;
  value: number;
  onValueChange?: (value: number) => void;
  /** Fires once when a drag or key press ends. */
  onValueCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Read out instead of the raw number: "80 percent". */
  valueText?: (value: number) => string;
  /** Gallery only: draw the thumb as if it were being dragged. */
  "data-dragging"?: boolean;
  className?: string;
};

/** "80 percent": the volume slider's value as a screen reader hears it. */
export function volumeText(v: number): string {
  return `${Math.round(v * 100)} percent`;
}

/**
 * One-thumb slider on Radix Slider: arrows step, Page keys jump, Home and End go to the ends. The
 * filled part is the text color, not the accent (the accent is kept for what is live). Hover and
 * dragging grow the thumb; the track is 4 px inside a 32 px hit area (40 on touch).
 */
export function Slider({
  label,
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 1,
  step = 0.05,
  disabled,
  valueText,
  className,
  "data-hover": dataHover,
  "data-focus": dataFocus,
  "data-active": dataActive,
  "data-dragging": dataDragging,
}: SliderProps) {
  const [dragging, setDragging] = useState(false);
  const drag = dataDragging || dragging;
  return (
    <S.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onValueChange?.(v[0] ?? min)}
      onValueCommit={(v) => {
        setDragging(false);
        onValueCommit?.(v[0] ?? min);
      }}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => setDragging(false)}
      data-hover={dataHover || undefined}
      data-dragging={drag || undefined}
      // Width comes from the caller (w-24 in the player); a full-width default would override it.
      className={cx("group relative flex h-8 touch-none select-none items-center pointer-coarse:h-10", disabled ? "cursor-not-allowed" : "cursor-pointer", className ?? "w-full")}
    >
      <S.Track className="relative h-1 grow overflow-hidden rounded-full bg-border">
        <S.Range className="absolute h-full rounded-full bg-text-muted group-data-disabled:bg-border-strong group-hover:bg-text group-data-hover:bg-text group-data-dragging:bg-text" />
      </S.Track>
      <S.Thumb
        aria-label={label}
        aria-valuetext={valueText?.(value)}
        data-focus={dataFocus || undefined}
        data-active={dataActive || undefined}
        className={cx(
          "block size-3 rounded-full border border-bg bg-text transition-transform duration-control motion-reduce:transition-none",
          "group-hover:scale-125 group-data-hover:scale-125 group-data-dragging:scale-125",
          "group-data-disabled:bg-border-strong group-data-disabled:scale-100",
        )}
      />
    </S.Root>
  );
}
