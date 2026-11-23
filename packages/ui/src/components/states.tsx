import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { cx } from "./cx.ts";
import { Icon, RotateCw, TriangleExclamationPoint, type IconComponent } from "./icon.tsx";

/**
 * What a list shows when it has nothing in it: one line on why, one next action. The copy points
 * somewhere: "Nothing liked yet. Press L on anything you want to keep."
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: IconComponent;
  title: string;
  children?: ReactNode;
  /** Exactly one next action, usually a Button or a link styled as one. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center gap-3 rounded-panel border border-border bg-surface px-6 py-12 text-center", className)}>
      {icon && (
        <span className="flex size-10 items-center justify-center rounded-control border border-border-strong bg-bg text-text-muted">
          <Icon icon={icon} size={20} />
        </span>
      )}
      <div className="flex max-w-90 flex-col gap-1">
        <p className="text-body-strong text-text">{title}</p>
        {children && <p className="text-small text-text-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * Something failed to load. Says what happened and what to do, with a retry. Danger hue on the
 * icon only, paired with the words, so color is never the only signal.
 */
export function ErrorState({
  title,
  children,
  onRetry,
  retrying = false,
  className,
}: {
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={cx("flex flex-col items-center gap-3 rounded-panel border border-border bg-surface px-6 py-12 text-center", className)}>
      <span className="flex size-10 items-center justify-center rounded-control border border-type-kit bg-bg text-type-kit">
        <Icon icon={TriangleExclamationPoint} size={20} />
      </span>
      <div className="flex max-w-90 flex-col gap-1">
        <p className="text-body-strong text-text">{title}</p>
        {children && <p className="text-small text-text-muted">{children}</p>}
      </div>
      {onRetry && (
        <Button size="sm" icon={RotateCw} onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
    </div>
  );
}
