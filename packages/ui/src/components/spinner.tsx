import { cx } from "./cx.ts";

/**
 * The loading ring: a quarter arc that turns. One of the two things allowed to loop (design spec,
 * Motion); it stands still under reduced motion. Decorative: the control that shows it sets aria-busy.
 */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  const r = size / 2 - 1.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={cx("shrink-0 animate-ring", className)}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={1.5} className="stroke-border-strong" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={`${c / 4} ${c}`}
        className="stroke-current"
      />
    </svg>
  );
}
