"use client";

import type { KeyboardEvent } from "react";
import { cx, type PreviewState } from "./cx.ts";
import { IconButton } from "./icon-button.tsx";
import { Minus, Plus } from "./icon.tsx";

export type StepperProps = PreviewState & {
  /** The accessible name of the group: "Key shift". */
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Without it the stepper is disabled (a type that lacks the control). */
  onChange?: (value: number) => void;
  /** The readout: "+2". */
  format?: (value: number) => string;
  /** What a screen reader hears when the value changes: "Em, up 2 semitones". */
  valueText?: string;
  /** Shown in the readout instead of format(value), e.g. the key name. */
  display?: string;
  className?: string;
};

/**
 * Minus, a monospace readout, plus. Design spec: Stepper (key shift in semitones), with an at-limit
 * state and focus. Arrow keys step while either button has focus; the readout is announced.
 */
export function Stepper({ label, value, min, max, step = 1, onChange, format = String, valueText, display, className, ...preview }: StepperProps) {
  const disabled = !onChange;
  const atMin = value <= min;
  const atMax = value >= max;
  const set = (v: number) => onChange?.(Math.max(min, Math.min(max, v)));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") set(value + step);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(value - step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      data-at-limit={atMin || atMax || undefined}
      data-disabled={disabled || undefined}
      className={cx("inline-flex h-8 items-center gap-1 rounded-control border border-border-strong bg-bg pointer-coarse:h-10", className)}
    >
      <IconButton icon={Minus} label={`Down one, ${label}`} disabled={disabled || atMin} onClick={() => set(value - step)} className="border-0" {...preview} />
      <span className={cx("min-w-12 text-center font-mono text-numeric tabular", disabled ? "text-border-strong" : "text-text")}>
        {display ?? format(value)}
      </span>
      <IconButton icon={Plus} label={`Up one, ${label}`} disabled={disabled || atMax} onClick={() => set(value + step)} className="border-0" />
      <span className="sr-only" aria-live="polite">
        {valueText ?? format(value)}
      </span>
    </div>
  );
}
