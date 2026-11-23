import type { ButtonHTMLAttributes, Ref } from "react";
import { cx, transition, type PreviewState } from "./cx.ts";
import { Icon, type IconComponent } from "./icon.tsx";
import { UiLink } from "./link.tsx";

export type IconButtonVariant = "ghost" | "pad";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> &
  PreviewState & {
    icon: IconComponent;
    /** Required: an icon alone is not a name. */
    label: string;
    variant?: IconButtonVariant;
    /** sm is 32 px, md is 40 px. */
    size?: "sm" | "md";
    /** A toggle that is on (loop, mute). Sets aria-pressed; leave undefined for plain actions. */
    on?: boolean;
    ref?: Ref<HTMLButtonElement>;
  };

const variants: Record<IconButtonVariant, string> = {
  ghost:
    "border-transparent bg-transparent text-text-muted ui-hover:bg-raised ui-hover:text-text ui-active:bg-bg ui-active:text-text aria-pressed:bg-raised aria-pressed:text-text disabled:border-transparent",
  // The pad: a square, slightly inset control with a hairline border (design spec, Concept).
  pad: "border-border-strong bg-bg text-text not-aria-pressed:ui-hover:bg-raised not-aria-pressed:ui-active:border-text aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-bg disabled:border-border",
};

export function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "sm",
  on,
  className,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={on}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-control border",
        transition,
        size === "sm" ? "size-8 pointer-coarse:size-10" : "size-10",
        variants[variant],
        "disabled:cursor-not-allowed disabled:bg-transparent disabled:text-border-strong",
        className,
      )}
      {...rest}
    >
      <Icon icon={icon} size={size === "sm" ? 16 : 20} />
    </button>
  );
}

/** A ghost icon button that is a link (notifications, search on phone). Navigates through UiLink. */
export function IconLink({
  href,
  icon,
  label,
  size = "md",
  className,
  ...preview
}: PreviewState & { href: string; icon: IconComponent; label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <UiLink
      href={href}
      aria-label={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-control border",
        transition,
        size === "sm" ? "size-8 pointer-coarse:size-10" : "size-10",
        variants.ghost,
        className,
      )}
      {...preview}
    >
      <Icon icon={icon} size={size === "sm" ? 16 : 20} />
    </UiLink>
  );
}
