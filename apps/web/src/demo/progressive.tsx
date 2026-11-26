import { useEffect, useRef, useState } from "react";

/**
 * Long lists render in steps: the first `first` items at once, then `step` more each time the end of
 * the list comes within about two screens of view. A list of 1,500 MIDI rows (each with a piano roll)
 * froze the page for seconds on a phone when it mounted whole; now only what is near the screen exists.
 * The count only grows, so items never vanish under the reader, and `atLeast` forces an index in
 * (keyboard selection moving past the rendered end).
 */
export function useProgressive<T>(items: readonly T[], { first = 30, step = 30, atLeast = 0 }: { first?: number; step?: number; atLeast?: number } = {}) {
  const [count, setCount] = useState(first);
  const sentinel = useRef<HTMLLIElement | null>(null);
  const root = useRef<HTMLElement | null | undefined>(undefined);
  const total = items.length;
  const shownCount = Math.min(total, Math.max(count, atLeast + 1));
  const more = shownCount < total;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    if (root.current === undefined) root.current = scrollParent(el); // found once: it forces a layout
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.max(c, shownCount) + step);
      },
      { root: root.current, rootMargin: "0px 0px 1600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, shownCount, step]);

  return {
    shown: shownCount < total ? items.slice(0, shownCount) : items,
    /** Put this last inside the list's <ul>: it is where the next step loads from. */
    sentinel: more ? <li ref={sentinel} aria-hidden="true" className="h-px list-none" /> : null,
  };
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}
