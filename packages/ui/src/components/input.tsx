"use client";

import { useId, type InputHTMLAttributes, type Ref } from "react";
import { cx, transition, type PreviewState } from "./cx.ts";
import { CircleExclamationPoint, Icon, Search, X, type IconComponent } from "./icon.tsx";
import { Kbd } from "./kbd.tsx";

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> &
  Pick<PreviewState, "data-focus"> & {
    label: string;
    /** Keep the label for screen readers only (search in the top bar). */
    hideLabel?: boolean;
    icon?: IconComponent;
    /** A key that focuses this field, shown at the right edge. */
    shortcut?: string;
    /** Shown under the field in the danger hue with an icon, and announced with the field. */
    error?: string;
    /** Help text under the field. Replaced by the error when there is one. */
    hint?: string;
    /** sm is 32 px, md is 40 px. */
    size?: "sm" | "md";
    /** Renders a clear button while the field has a value. */
    onClear?: () => void;
    ref?: Ref<HTMLInputElement>;
  };

export function TextInput({
  label,
  hideLabel = false,
  icon,
  shortcut,
  error,
  hint,
  size = "md",
  onClear,
  disabled,
  className,
  id,
  value,
  "data-focus": dataFocus,
  ref,
  ...rest
}: TextInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;
  const filled = value !== undefined && value !== "";
  return (
    <div className={cx("flex min-w-0 flex-col gap-2", className)}>
      <label htmlFor={inputId} className={hideLabel ? "sr-only" : "text-small text-text-muted"}>
        {label}
      </label>
      <div
        data-focus={dataFocus}
        data-ui="field"
        data-size={size}
        className={cx(
          "flex items-center gap-2 rounded-control border px-3",
          transition,
          size === "sm" ? "h-8" : "h-10",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent focus-within:outline-solid",
          disabled
            ? "cursor-not-allowed border-border bg-surface text-text-muted"
            : error
              ? "border-type-kit bg-bg"
              : "border-border-strong bg-bg ui-hover:border-text-muted",
        )}
      >
        {icon && <Icon icon={icon} className="text-text-muted" />}
        <input
          ref={ref}
          id={inputId}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:text-text-muted"
          {...rest}
        />
        {onClear && filled && !disabled ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label.toLowerCase()}`}
            className={cx("-mr-1 inline-flex size-6 items-center justify-center rounded-control text-text-muted ui-hover:bg-raised ui-hover:text-text", transition)}
          >
            <Icon icon={X} />
          </button>
        ) : shortcut && !filled ? (
          <Kbd>{shortcut}</Kbd>
        ) : null}
      </div>
      {message && (
        <p id={messageId} className={cx("flex items-center gap-1 text-small", error ? "text-type-kit" : "text-text-muted")}>
          {error && <Icon icon={CircleExclamationPoint} />}
          {message}
        </p>
      )}
    </div>
  );
}

/** The search field: magnifier, "/" to focus, a clear button once there is a query. */
export function SearchInput({ label = "Search", shortcut = "/", ...props }: Omit<TextInputProps, "icon" | "type" | "label"> & { label?: string }) {
  return <TextInput type="search" icon={Search} label={label} shortcut={shortcut} autoComplete="off" {...props} />;
}
