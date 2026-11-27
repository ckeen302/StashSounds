import { getEngine } from "@stash/audio";
import { silenceOthers } from "../exclusive";
import { midiPlayer } from "../midi/synth";
import { drifted, HOLD_MS, rubberBand, swipeOf } from "./gestures";
import { buzz } from "./tactile";

/**
 * The pocket model's hands, for touch screens only (a mouse never triggers either):
 *   - swipe the transport left for the next sound, right for the one before, the screen following
 *     the thumb;
 *   - hold a finger on any sound's row or card to hear it, and lift to stop: auditioning without
 *     losing your place in the list.
 */

/** Stops whatever is sounding, in every player. */
function stopAll() {
  const engine = getEngine();
  const st = engine.getState().status;
  if (st === "playing" || st === "loading") engine.pause();
  midiPlayer().pause();
  silenceOthers();
}

/** Swallows the click a gesture's lift would otherwise send (opening the sheet, following a link). */
function swallowNextClick() {
  const eat = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 600);
}

function startSwipe(e: PointerEvent, bar: HTMLElement) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  const t0 = performance.now();
  let live = false;
  const move = (m: PointerEvent) => {
    if (m.pointerId !== e.pointerId) return;
    const dx = m.clientX - x0;
    if (!live && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(m.clientY - y0)) live = true;
    if (live) bar.style.setProperty("--sp-swipe", `${rubberBand(dx).toFixed(1)}px`);
  };
  const end = (u: PointerEvent) => {
    if (u.pointerId !== e.pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    const dx = u.clientX - x0;
    const way = u.type === "pointerup" && live ? swipeOf(dx, u.clientY - y0, performance.now() - t0) : null;
    bar.dataset.settling = "";
    bar.style.setProperty("--sp-swipe", "0px");
    setTimeout(() => delete bar.dataset.settling, 220);
    if (live) swallowNextClick();
    if (!way) return;
    const engine = getEngine();
    const s = engine.getState();
    const can = way === "next" ? s.queueIndex >= 0 && s.queueIndex < s.queue.length - 1 : s.queueIndex > 0;
    if (!can) {
      buzz(20);
      return;
    }
    buzz(8);
    if (way === "next") engine.next();
    else engine.previous();
  };
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

const NOT_A_HOLD = "input, select, textarea, [data-play-state], [role=slider], .sp-hero-pad, .sp-hero-keys, .sp-pad-drum, .lib-bank, [role=menu], dialog";

function startHold(e: PointerEvent, row: HTMLElement, play: HTMLButtonElement) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  let held = false;
  let started = false;
  const timer = window.setTimeout(() => {
    held = true;
    row.dataset.holding = "";
    buzz(12);
    // Already sounding: the hold just keeps it going, and lifting leaves it be.
    if (play.dataset.playState !== "playing") {
      started = true;
      play.click();
    }
  }, HOLD_MS);
  const noMenu = (c: Event) => c.preventDefault();
  window.addEventListener("contextmenu", noMenu, { capture: true });
  const cleanup = () => {
    clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("scroll", cancel, true);
    setTimeout(() => window.removeEventListener("contextmenu", noMenu, { capture: true }), 50);
  };
  const cancel = () => {
    if (held) return;
    cleanup();
  };
  const move = (m: PointerEvent) => {
    if (m.pointerId === e.pointerId && !held && drifted(m.clientX - x0, m.clientY - y0)) cancel();
  };
  const end = (u: PointerEvent) => {
    if (u.pointerId !== e.pointerId) return;
    cleanup();
    if (!held) return;
    delete row.dataset.holding;
    if (started) stopAll();
    swallowNextClick();
  };
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("scroll", cancel, { capture: true, passive: true });
}

/** Starts the phone gestures. Call once. */
export function startPhoneControls() {
  if (typeof document === "undefined") return;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      const t = e.target as Element | null;
      if (!t?.closest) return;
      const bar = t.closest<HTMLElement>('section[aria-label="Player"]');
      if (bar) {
        if (!t.closest("button:not([aria-label='Open player']), [role=slider]")) startSwipe(e, bar);
        return;
      }
      if (t.closest(NOT_A_HOLD) || !t.closest("main")) return;
      const row = t.closest<HTMLElement>("li, .sp-cart");
      const play = row?.querySelector<HTMLButtonElement>("button[data-play-state]:not(:disabled)");
      if (row && play) startHold(e, row, play);
    },
    { passive: true, capture: true },
  );
}
