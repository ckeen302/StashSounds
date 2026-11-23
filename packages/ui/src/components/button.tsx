import type { ButtonHTMLAttributes, Ref } from "react";
import { cx, transition, type PreviewState } from "./cx.ts";
import { Icon, type IconComponent } from "./icon.tsx";
import { Spinner } from "./spinner.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  PreviewState & {
    variant?: ButtonVariant;
    /** sm is 32 px, md is 40 px. */
    size?: ButtonSize;
    /** Shows the ring, keeps the label, and ignores presses until it clears. */
    loading?: boolean;
    icon?: IconComponent;
    children: string;
    ref?: Ref<HTMLButtonElement>;
  };

const variants: Record<ButtonVariant, string> = {
  // The primary action is one of the lit things: accent face, bg text (16.7 to 1).
  primary:
    "border-accent bg-accent text-bg ui-hover:border-accent/85 ui-hover:bg-accent/85 ui-active:border-accent/70 ui-active:bg-accent/70",
  secondary:
    "border-border-strong bg-surface text-text ui-hover:bg-raised ui-hover:border-text-muted ui-active:bg-bg",
  ghost: "border-transparent bg-transparent text-text ui-hover:bg-raised ui-active:bg-surface",
  danger: "border-type-kit bg-transparent text-type-kit ui-hover:bg-type-kit/16 ui-active:bg-type-kit/24",
};

const disabledClass =
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface disabled:text-text-muted";

export const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-2 px-3 pointer-coarse:h-10",
  md: "h-10 gap-2 px-4",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = "button",
  onClick,
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control border text-body-strong",
        transition,
        buttonSizes[size],
        variants[variant],
        disabledClass,
        loading && "cursor-progress",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon icon={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}
