import { cx } from "./cx.ts";

/** A computer-key hint, set like an engraved legend: "/", "L", "Shift+D". */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-control border border-border-strong px-1 font-mono text-label text-label-caps text-text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
