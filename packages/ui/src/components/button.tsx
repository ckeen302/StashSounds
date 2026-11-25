import type { ButtonHTMLAttributes, Ref } from "react";
import { cx, transition, type PreviewState } from "./cx.ts";
import { Icon, type IconComponent } from "./icon.tsx";
import { UiLink } from "./link.tsx";
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
  ghost: "border-transparent bg-transparent text-text ui-hover:bg-raised ui-active:bg-bg",
  // Type colors sit only on surface, raised or their own 16 percent tint (the measured pairs).
  danger: "border-type-kit bg-transparent text-type-kit ui-hover:bg-raised ui-active:bg-type-kit/16",
};

/** Disabled keeps each variant's outline: a ghost stays borderless, the others go to the plain hairline. */
const disabledClass: Record<ButtonVariant, string> = {
  primary: "disabled:border-border disabled:bg-surface",
  secondary: "disabled:border-border disabled:bg-surface",
  ghost: "disabled:border-transparent disabled:bg-transparent",
  danger: "disabled:border-border disabled:bg-transparent",
};

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
      data-ui="button"
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control border text-body-strong",
        transition,
        buttonSizes[size],
        variants[variant],
        "disabled:cursor-not-allowed disabled:text-text-muted",
        disabledClass[variant],
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

/** A link that looks like a button ("Sign in" in the top bar). It navigates on the client through UiLink. */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
  ...preview
}: PreviewState & { href: string; variant?: ButtonVariant; size?: ButtonSize; icon?: IconComponent; children: string; className?: string }) {
  return (
    <UiLink
      href={href}
      data-ui="button"
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control border text-body-strong",
        transition,
        buttonSizes[size],
        variants[variant],
        className,
      )}
      {...preview}
    >
      {icon ? <Icon icon={icon} /> : null}
      <span>{children}</span>
    </UiLink>
  );
}
