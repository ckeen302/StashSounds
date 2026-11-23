import { cx } from "./cx.ts";

/**
 * Loading placeholders. They hold the exact footprint of what replaces them, so nothing shifts,
 * and they do not pulse: only the loading ring and the logo may loop (design spec, Motion).
 */
export function SkeletonBlock({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block rounded-control bg-raised", className)} />;
}

/** Lines of text: body lines are 20 px tall with a 12 px bar inside; the last line runs short. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cx("flex flex-col", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} aria-hidden="true" className="flex h-5 items-center">
          <span className={cx("block h-3 rounded-control bg-raised", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
        </span>
      ))}
    </div>
  );
}

/** A panel's footprint: an uploader card or a stat block while its data loads. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cx("flex flex-col gap-4 rounded-panel border border-border bg-surface p-4", className)}>
      <div className="flex items-center gap-3">
        <SkeletonBlock className="size-16 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <SkeletonBlock className="h-4 w-1/2" />
          <SkeletonBlock className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonBlock className="h-10 w-full" />
    </div>
  );
}
