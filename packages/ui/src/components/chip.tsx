import type { ItemType } from "@stash/contracts";
import type { ButtonHTMLAttributes } from "react";
import { cx, transition, type PreviewState } from "./cx.ts";
import { Check, Icon, X } from "./icon.tsx";

export const TYPE_LABEL: Record<ItemType, string> = {
  loop: "Loop",
  oneshot: "One-shot",
  kit: "Kit",
  midi: "MIDI",
  preset: "Preset",
};

/** The type color at 16 percent behind the full color as text (CHIP_TINT_OPACITY). */
const typeTint: Record<ItemType, string> = {
  loop: "bg-type-loop/16 text-type-loop",
  oneshot: "bg-type-oneshot/16 text-type-oneshot",
  kit: "bg-type-kit/16 text-type-kit",
  midi: "bg-type-midi/16 text-type-midi",
  preset: "bg-type-preset/16 text-type-preset",
};

/** A content type chip. Static: the type color belongs to the sound and is never a button. */
export function TypeChip({ type, className }: { type: ItemType; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 shrink-0 items-center rounded-control px-2 text-label text-label-caps", typeTint[type], className)}>
      {TYPE_LABEL[type]}
    </span>
  );
}

type ChipButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick"> & PreviewState;

/**
 * A tag. Plain text when it only labels; a button when it does something (onClick), or a removable
 * token on the upload form (onRemove).
 */
export function TagChip({
  children,
  onClick,
  onRemove,
  className,
  ...rest
}: ChipButtonProps & { children: string; onClick?: () => void; onRemove?: () => void }) {
  const face = "inline-flex h-6 min-w-0 shrink-0 items-center gap-1 rounded-control bg-raised px-2 text-small text-text-muted";
  if (!onClick && !onRemove) return <span className={cx(face, className)}>{children}</span>;
  return (
    <button
      type="button"
      onClick={onRemove ?? onClick}
      aria-label={onRemove ? `Remove tag ${children}` : undefined}
      className={cx(face, transition, "ui-hover:text-text ui-active:bg-surface", className)}
      {...rest}
    >
      <span className="truncate">{children}</span>
      {onRemove && <Icon icon={X} />}
    </button>
  );
}

/**
 * A filter. A toggle (aria-pressed) when it switches a filter on and off, or a removable token for
 * a filter already applied (onRemove), which reads "Remove filter 140 to 150 BPM".
 */
export function FilterChip({
  children,
  selected = false,
  onToggle,
  onRemove,
  className,
  ...rest
}: ChipButtonProps & { children: string; selected?: boolean; onToggle?: () => void; onRemove?: () => void }) {
  const removable = Boolean(onRemove);
  return (
    <button
      type="button"
      aria-pressed={removable ? undefined : selected}
      aria-label={removable ? `Remove filter ${children}` : undefined}
      onClick={onRemove ?? onToggle}
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-control border px-3 text-small pointer-coarse:h-10",
        transition,
        selected || removable
          ? "border-text bg-raised text-text ui-hover:border-text-muted ui-active:bg-surface"
          : "border-border-strong bg-transparent text-text-muted ui-hover:border-text-muted ui-hover:text-text ui-active:bg-surface",
        "disabled:cursor-not-allowed disabled:border-border disabled:text-border-strong",
        className,
      )}
      {...rest}
    >
      {selected && !removable && <Icon icon={Check} />}
      <span>{children}</span>
      {removable && <Icon icon={X} />}
    </button>
  );
}
