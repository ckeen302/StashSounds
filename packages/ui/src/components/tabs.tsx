"use client";

import { Tabs as T } from "radix-ui";
import type { ReactNode } from "react";
import { cx, transition, type PreviewState } from "./cx.ts";
import { formatCount } from "./stat.tsx";

/** Underline tabs on Radix Tabs: arrow keys move between tabs, Home and End jump. */
export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <T.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} className={cx("flex flex-col gap-4", className)}>
      {children}
    </T.Root>
  );
}

export function TabList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <T.List aria-label={label} className={cx("-mx-2 flex gap-2 overflow-x-auto border-b border-border", className)}>
      {children}
    </T.List>
  );
}

export function Tab({
  value,
  children,
  count,
  disabled,
  ...preview
}: PreviewState & { value: string; children: string; count?: number; disabled?: boolean }) {
  return (
    <T.Trigger
      value={value}
      disabled={disabled}
      className={cx(
        // The ring is drawn inside the tab so the scrolling list cannot clip it.
        "relative inline-flex h-10 shrink-0 items-center gap-2 rounded-control px-2 text-body-strong text-text-muted -outline-offset-2",
        transition,
        "ui-hover:text-text aria-selected:text-text",
        "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent aria-selected:after:bg-text",
        "disabled:cursor-not-allowed disabled:text-border-strong",
      )}
      {...preview}
    >
      {children}
      {count !== undefined && (
        <span className="font-mono text-numeric tabular text-text-muted">
          {formatCount(count)}
        </span>
      )}
    </T.Trigger>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <T.Content value={value} className={cx("rounded-panel", className)}>
      {children}
    </T.Content>
  );
}
