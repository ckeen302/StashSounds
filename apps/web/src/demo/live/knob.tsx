import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { buzz, click } from "./tactile";

/**
 * A knob that turns: drag up or right to turn it up, down or left to turn it down, scroll over it,
 * or use the arrow keys, Page Up and Down, Home and End once it has focus. It clicks at each detent.
 * It is a slider to assistive tech, with its value read out as text.
 */

/** The knob's sweep: from -135° (first step) to +135° (last), the way hardware knobs turn. */
export const SWEEP = 270;

/** The angle a step sits at. */
export function knobAngle(index: number, steps: number): number {
  if (steps <= 1) return 0;
  return -SWEEP / 2 + (SWEEP * Math.max(0, Math.min(steps - 1, index))) / (steps - 1);
}

/** The step a drag lands on: `px` pixels of travel from `start`, `pxPerStep` pixels a step. */
export function stepAfterDrag(start: number, px: number, steps: number, pxPerStep: number): number {
  return Math.max(0, Math.min(steps - 1, start + Math.round(px / pxPerStep)));
}

export function Knob({
  label,
  steps,
  index,
  onChange,
  valueText,
  hot = false,
  className = "",
  style,
}: {
  label: string;
  steps: number;
  index: number;
  onChange: (index: number) => void;
  valueText: string;
  /** The orange mark, for the knob that matters most. */
  hot?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const drag = useRef<{ x: number; y: number; start: number; id: number } | null>(null);
  const set = (next: number) => {
    const n = Math.max(0, Math.min(steps - 1, next));
    if (n === index) return;
    click("tick");
    onChange(n);
  };
  // Finer travel for knobs with many steps, so the whole sweep fits a comfortable drag.
  const pxPerStep = Math.max(4, Math.min(16, 220 / steps));

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { x: e.clientX, y: e.clientY, start: index, id: e.pointerId };
    e.currentTarget.dataset.turning = "";
    if (e.pointerType === "touch") buzz(4);
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // Up and right both turn it up: whichever way the hand moved further wins.
    const dx = e.clientX - d.x;
    const dy = d.y - e.clientY;
    const travel = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    const next = stepAfterDrag(d.start, travel, steps, pxPerStep);
    if (next !== index) {
      set(next);
      if (e.pointerType === "touch") buzz(3);
    }
  };
  const end = (e: PointerEvent<HTMLSpanElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    delete e.currentTarget.dataset.turning;
  };
  // The wheel turns it once it has focus (scrolling past it never does). A native listener: React's
  // wheel handlers are passive and cannot keep the page from scrolling.
  const knob = useRef<HTMLSpanElement>(null);
  const latest = useRef(set);
  const at = useRef(index);
  useEffect(() => {
    latest.current = set;
    at.current = index;
  });
  useEffect(() => {
    const el = knob.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el || e.deltaY === 0) return;
      e.preventDefault();
      latest.current(at.current + (e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    const big = Math.max(1, Math.round(steps / 8));
    const to: Record<string, number> = {
      ArrowUp: index + 1,
      ArrowRight: index + 1,
      ArrowDown: index - 1,
      ArrowLeft: index - 1,
      PageUp: index + big,
      PageDown: index - big,
      Home: 0,
      End: steps - 1,
    };
    const next = to[e.key];
    if (next === undefined) return;
    // Handled here, so the site's arrow-key shortcuts leave it alone.
    e.preventDefault();
    set(next);
  };

  return (
    <span className={`sp-knob-wrap ${className}`} style={style}>
      <span
        ref={knob}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={steps - 1}
        aria-valuenow={index}
        aria-valuetext={valueText}
        className="sp-knob sp-knob-live"
        style={{ ["--sp-turn" as string]: `${knobAngle(index, steps)}deg`, ...(hot ? { ["--sp-knob-mark" as string]: "var(--sp-hot)" } : {}) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
      />
      <span className="sp-knob-value" aria-hidden="true">
        {valueText}
      </span>
      <span className="sp-label" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
