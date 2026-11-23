import { cx } from "./cx.ts";
import { SkeletonBlock } from "./skeleton.tsx";

/** Counts: grouped below ten thousand (1,204), compact above (12.4K). */
export function formatCount(n: number): string {
  if (n < 10_000) return new Intl.NumberFormat("en-US").format(n);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** An engraved label over a number: FOLLOWERS over 1,204. */
export function Stat({
  label,
  value,
  loading = false,
  className,
}: {
  label: string;
  /** A count, or preformatted text such as a duration. */
  value?: number | string;
  loading?: boolean;
  className?: string;
}) {
  return (
    <dl className={cx("flex min-w-0 flex-col", className)} aria-busy={loading || undefined}>
      <dt className="text-label text-label-caps text-text-muted">{label}</dt>
      <dd className="flex h-5 items-center font-mono text-numeric tabular text-text">
        {loading || value === undefined ? (
          <>
            <SkeletonBlock className="h-3 w-12" />
            <span className="sr-only">Loading</span>
          </>
        ) : typeof value === "number" ? (
          formatCount(value)
        ) : (
          value
        )}
      </dd>
    </dl>
  );
}
