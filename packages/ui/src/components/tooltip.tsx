"use client";

import { Tooltip as T } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx.ts";
import { Kbd } from "./kbd.tsx";

/** The tooltip face: raised panel, small text, the shortcut as an engraved key. */
export function TooltipSurface({ children, shortcut, className }: { children: ReactNode; shortcut?: string; className?: string }) {
  return (
    <div className={cx("flex items-center gap-2 rounded-control border border-border bg-raised py-1 pl-2 text-small text-text", shortcut ? "pr-1" : "pr-2", className)}>
      <span>{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </div>
  );
}

/** Mount once near the root so neighbouring tooltips open without a second delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider>{children}</T.Provider>;
}

/**
 * A tooltip with an optional shortcut key (design spec: every row action shows its key here).
 * The child must be a focusable element that accepts a ref, such as IconButton or Button.
 */
export function Tooltip({
  content,
  shortcut,
  side = "top",
  children,
  open,
  onOpenChange,
}: {
  content: string;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <T.Root open={open} onOpenChange={onOpenChange}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={8} collisionPadding={8} className="z-50 animate-overlay">
          <TooltipSurface shortcut={shortcut}>{content}</TooltipSurface>
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
