"use client";

import { Toast as T } from "radix-ui";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./button.tsx";
import { cx } from "./cx.ts";
import { CircleCheck, CircleExclamationPoint, Icon, Info, X } from "./icon.tsx";

export type ToastTone = "info" | "success" | "error";

export type ToastOptions = {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** One action, usually Undo. altText says how to reach it without the toast ("Undo from the Library"). */
  action?: { label: string; altText: string; onAction: () => void };
  /** ms before it leaves on its own. */
  duration?: number;
};

const tones: Record<ToastTone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "text-text-muted" },
  success: { icon: CircleCheck, className: "text-type-preset" },
  error: { icon: CircleExclamationPoint, className: "text-type-kit" },
};

/** The toast face: raised panel, tone icon (never color alone), title, one line, one action. */
export function ToastSurface({
  tone = "info",
  title,
  description,
  action,
  close,
  className,
}: {
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  close?: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <div className={cx("flex w-full items-start gap-3 rounded-panel border border-border bg-raised p-3", className)}>
      <span className={cx("flex h-5 items-center", t.className)}>
        <Icon icon={t.icon} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        {title}
        {description}
      </div>
      {/* 32 px controls centred on the 20 px title line. */}
      <div className="-my-1 flex shrink-0 items-center gap-1">
        {action}
        {close}
      </div>
    </div>
  );
}

const titleClass = "text-body-strong text-text";
const descriptionClass = "text-small text-text-muted";

type Entry = ToastOptions & { id: number; open: boolean };
const ToastContext = createContext<((t: ToastOptions) => void) | null>(null);

/** Show a toast from anywhere under ToastProvider: const toast = useToast(); toast({ title: "Saved" }). */
export function useToast(): (t: ToastOptions) => void {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast needs a ToastProvider above it");
  return push;
}

/**
 * Toasts on Radix Toast: announced politely (errors assertively), paused while hovered or focused,
 * F8 jumps to them, swipe right dismisses. They sit above the player bar, bottom right.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const next = useRef(0);
  const push = useCallback((t: ToastOptions) => {
    const id = next.current++;
    setEntries((list) => [...list.filter((e) => e.open), { ...t, id, open: true }]);
  }, []);
  const close = useCallback((id: number) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, open: false } : e))), []);
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      <T.Provider swipeDirection="right" label="Notifications">
        {children}
        {entries.map((e) => (
          <T.Root
            key={e.id}
            open={e.open}
            onOpenChange={(o) => !o && close(e.id)}
            duration={e.duration ?? (e.action ? 8000 : 5000)}
            type={e.tone === "error" ? "foreground" : "background"}
            className="animate-overlay"
          >
            <ToastSurface
              tone={e.tone}
              title={<T.Title className={titleClass}>{e.title}</T.Title>}
              description={e.description ? <T.Description className={descriptionClass}>{e.description}</T.Description> : undefined}
              action={
                e.action ? (
                  <T.Action asChild altText={e.action.altText}>
                    <Button size="sm" variant="ghost" onClick={e.action.onAction}>
                      {e.action.label}
                    </Button>
                  </T.Action>
                ) : undefined
              }
              close={
                <T.Close aria-label="Dismiss" className="inline-flex size-8 items-center justify-center rounded-control text-text-muted transition-colors duration-control ui-hover:bg-surface ui-hover:text-text">
                  <Icon icon={X} />
                </T.Close>
              }
            />
          </T.Root>
        ))}
        <T.Viewport className="fixed right-0 bottom-16 z-50 flex w-full max-w-100 flex-col gap-2 p-6" />
      </T.Provider>
    </ToastContext.Provider>
  );
}

/** The gallery's frozen picture of a toast. */
export function ToastPreview({ tone, title, description, action }: Omit<ToastOptions, "duration" | "action"> & { action?: string }) {
  return (
    <ToastSurface
      tone={tone}
      title={<p className={titleClass}>{title}</p>}
      description={description ? <p className={descriptionClass}>{description}</p> : undefined}
      action={
        action ? (
          <Button size="sm" variant="ghost">
            {action}
          </Button>
        ) : undefined
      }
      close={
        <span className="inline-flex size-8 items-center justify-center rounded-control text-text-muted">
          <Icon icon={X} />
        </span>
      }
    />
  );
}
