import { flushSync } from "react-dom";

/**
 * Page changes as mode changes on hardware: the screen slides to the next bank, left when it is to
 * the right of the one you were on, right when it is to the left, and the transport, the top panel
 * and the pad bank stay put (only the content area is part of the transition). The sound never
 * stops: nothing outside the content area re-renders. Skipped where the browser has no view
 * transitions or the visitor asks for less motion.
 */

/** The bank order, as the pad bank lists it: which way a change of page slides. */
const ORDER = ["/", "/loops", "/midi", "/kits", "/one-shots", "/sfx", "/presets", "/samples", "/upload"];

function bankOf(path: string): number {
  const exact = ORDER.indexOf(path);
  if (exact >= 0) return exact;
  // A page inside a bank (a loop, a kit, a song) sits just past its bank.
  if (path.startsWith("/loop/") || path.startsWith("/pack/")) return 1.5;
  if (path.startsWith("/midi/")) return 2.5;
  if (path.startsWith("/kit")) return 3.5;
  if (path.startsWith("/presets/") || path.startsWith("/song/")) return 6.5;
  if (/^\/(samples\/|sampled\/|samples-)/.test(path)) return 7.5;
  return 9;
}

/** Which way the new page comes in from. */
export function slideOf(from: string, to: string): "forward" | "back" {
  return bankOf(to) >= bankOf(from) ? "forward" : "back";
}

type ViewTransitionDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

export function pageChange(from: string, to: string, update: () => void) {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
    update();
    return;
  }
  document.documentElement.dataset.slide = slideOf(from, to);
  const t = doc.startViewTransition(() => flushSync(update));
  void t.finished.finally(() => delete document.documentElement.dataset.slide);
}
