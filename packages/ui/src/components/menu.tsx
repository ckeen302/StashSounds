"use client";

import { ContextMenu as CM, DropdownMenu as DM } from "radix-ui";
import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconComponent } from "./icon.tsx";
import { Kbd } from "./kbd.tsx";

export type MenuEntry =
  | {
      label: string;
      icon?: IconComponent;
      shortcut?: string;
      disabled?: boolean;
      /** Report, delete: the danger hue with the words, never color alone. */
      destructive?: boolean;
      onSelect?: () => void;
    }
  | { separator: true };

const surfaceClass = "z-50 flex min-w-56 flex-col rounded-panel border border-border bg-raised p-1";
const itemClass =
  "flex h-8 cursor-default select-none items-center gap-2 rounded-control px-2 text-body transition-colors duration-control data-highlighted:bg-surface data-disabled:cursor-not-allowed data-disabled:text-border-strong pointer-coarse:h-10";
const separatorClass = "my-1 h-px bg-border";

function ItemFace({ entry }: { entry: Exclude<MenuEntry, { separator: true }> }) {
  return (
    <>
      {entry.icon && <Icon icon={entry.icon} className={entry.disabled ? "" : entry.destructive ? "text-type-kit" : "text-text-muted"} />}
      <span className="flex-1">{entry.label}</span>
      {entry.shortcut && <Kbd>{entry.shortcut}</Kbd>}
    </>
  );
}

function toneClass(entry: Exclude<MenuEntry, { separator: true }>) {
  return entry.disabled ? "" : entry.destructive ? "text-type-kit" : "text-text";
}

function isSeparator(e: MenuEntry): e is { separator: true } {
  return "separator" in e;
}

/**
 * The overflow menu on Radix Dropdown Menu: arrow keys move, typing jumps to a label, Escape closes
 * and returns focus to the trigger. Fades with a 4 px rise in 160 ms.
 */
export function Menu({ trigger, entries, align = "end", open, onOpenChange }: { trigger: ReactElement; entries: MenuEntry[]; align?: "start" | "end"; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <DM.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={4} collisionPadding={8} className={cx(surfaceClass, "animate-overlay")}>
          {entries.map((e, i) =>
            isSeparator(e) ? (
              <DM.Separator key={`sep-${i}`} className={separatorClass} />
            ) : (
              <DM.Item key={e.label} disabled={e.disabled} onSelect={e.onSelect} className={cx(itemClass, toneClass(e))}>
                <ItemFace entry={e} />
              </DM.Item>
            ),
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** The same menu on right-click or long-press (Radix Context Menu), for result rows. */
export function ContextMenu({ children, entries }: { children: ReactElement; entries: MenuEntry[] }) {
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content collisionPadding={8} className={cx(surfaceClass, "animate-overlay")}>
          {entries.map((e, i) =>
            isSeparator(e) ? (
              <CM.Separator key={`sep-${i}`} className={separatorClass} />
            ) : (
              <CM.Item key={e.label} disabled={e.disabled} onSelect={e.onSelect} className={cx(itemClass, toneClass(e))}>
                <ItemFace entry={e} />
              </CM.Item>
            ),
          )}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

/** The gallery's frozen picture of an open menu. `highlighted` marks the item under focus. */
export function MenuPreview({ entries, highlighted, className }: { entries: MenuEntry[]; highlighted?: string; className?: string }): ReactNode {
  return (
    <div className={cx(surfaceClass, className)}>
      {entries.map((e, i) =>
        isSeparator(e) ? (
          <div key={`sep-${i}`} className={separatorClass} />
        ) : (
          <div key={e.label} data-highlighted={e.label === highlighted ? "" : undefined} data-disabled={e.disabled ? "" : undefined} className={cx(itemClass, toneClass(e))}>
            <ItemFace entry={e} />
          </div>
        ),
      )}
    </div>
  );
}
