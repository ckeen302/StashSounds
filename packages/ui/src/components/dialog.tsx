"use client";

import { Dialog as D } from "radix-ui";
import type { FormEvent, ReactElement, ReactNode } from "react";
import { Button } from "./button.tsx";
import { cx } from "./cx.ts";
import { CircleExclamationPoint, Icon, X } from "./icon.tsx";

export type DialogVariant = "confirm" | "form";

type SurfaceProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  error?: string;
  close?: ReactNode;
  className?: string;
};

/** The dialog face: a raised panel, title, one line of description, body, error, actions. */
export function DialogSurface({ title, description, children, footer, error, close, className }: SurfaceProps) {
  return (
    <div className={cx("relative flex w-full max-w-110 flex-col gap-4 rounded-panel border border-border bg-raised p-6", className)}>
      <div className="flex flex-col gap-1 pr-8">
        {title}
        {description}
      </div>
      {children}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-small text-type-kit">
          <Icon icon={CircleExclamationPoint} className="mt-0" />
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">{footer}</div>
      {close && <div className="absolute top-4 right-4">{close}</div>}
    </div>
  );
}

const titleClass = "text-title text-text";
const descriptionClass = "text-small text-text-muted";

export type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The control that opens it; it gets focus back on close. */
  trigger?: ReactElement;
  variant?: DialogVariant;
  title: string;
  description?: string;
  /** Form fields for the form variant. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Confirm is destructive (delete, take down): the danger button. */
  destructive?: boolean;
  /** The action is in flight: confirm shows the ring, cancel and close wait. */
  loading?: boolean;
  /** What went wrong and what to do, shown above the actions. */
  error?: string;
  onConfirm?: () => void;
};

function Actions({ variant, confirmLabel, cancelLabel, destructive, loading, onConfirm, Cancel }: Pick<DialogProps, "variant" | "confirmLabel" | "cancelLabel" | "destructive" | "loading" | "onConfirm"> & { Cancel: (props: { children: ReactElement }) => ReactNode }) {
  return (
    <>
      <Cancel>
        <Button variant="ghost" size="md" disabled={loading}>
          {cancelLabel ?? "Cancel"}
        </Button>
      </Cancel>
      <Button
        variant={destructive ? "danger" : "primary"}
        size="md"
        loading={loading}
        type={variant === "form" ? "submit" : "button"}
        onClick={variant === "form" ? undefined : onConfirm}
      >
        {confirmLabel}
      </Button>
    </>
  );
}

/**
 * A modal dialog on Radix Dialog: focus moves in and is trapped, Escape closes, focus returns to the
 * trigger. Fades with a 4 px rise in 160 ms. Confirm asks one question; form wraps its fields in a
 * form so Enter submits.
 */
export function Dialog({ open, onOpenChange, trigger, variant = "confirm", title, description, children, error, loading, onConfirm, ...actions }: DialogProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!loading) onConfirm?.();
  };
  const surface = (
    <DialogSurface
      title={<D.Title className={titleClass}>{title}</D.Title>}
      description={description ? <D.Description className={descriptionClass}>{description}</D.Description> : undefined}
      error={error}
      close={
        <D.Close asChild>
          <button type="button" aria-label="Close" disabled={loading} className="inline-flex size-8 items-center justify-center rounded-control text-text-muted transition-colors duration-control ui-hover:bg-surface ui-hover:text-text disabled:text-border-strong">
            <Icon icon={X} />
          </button>
        </D.Close>
      }
      footer={<Actions variant={variant} loading={loading} onConfirm={onConfirm} Cancel={({ children }) => <D.Close asChild>{children}</D.Close>} {...actions} />}
    >
      {children}
    </DialogSurface>
  );
  return (
    <D.Root open={open} onOpenChange={(o) => (loading && !o ? undefined : onOpenChange?.(o))}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 grid animate-scrim place-items-center overflow-y-auto bg-bg/80 p-4">
          <D.Content className="flex w-full animate-overlay justify-center" {...(description ? {} : { "aria-describedby": undefined })}>
            {variant === "form" ? (
              <form onSubmit={submit} className="flex w-full justify-center">
                {surface}
              </form>
            ) : (
              surface
            )}
          </D.Content>
        </D.Overlay>
      </D.Portal>
    </D.Root>
  );
}

/** The gallery's frozen picture of an open dialog: same face, plain headings, no focus trap. */
export function DialogPreview({ variant = "confirm", title, description, children, error, loading, ...actions }: Omit<DialogProps, "open" | "onOpenChange" | "trigger">) {
  return (
    <DialogSurface
      title={<h3 className={titleClass}>{title}</h3>}
      description={description ? <p className={descriptionClass}>{description}</p> : undefined}
      error={error}
      close={
        <span className="inline-flex size-8 items-center justify-center rounded-control text-text-muted">
          <Icon icon={X} />
        </span>
      }
      footer={<Actions variant={variant} loading={loading} Cancel={({ children }) => children} {...actions} />}
    >
      {children}
    </DialogSurface>
  );
}
