import { useSyncExternalStore } from "react";
import { unmetered } from "./meter";

/**
 * The machine's feel: controls that stay pressed long enough to see on a quick tap, a soft click
 * from the hardware under each press (off with the CLK key, remembered in this browser), a detent
 * tick as a knob turns, and a tiny buzz on phones that have one.
 *
 * The clicks are synthesized (no files), on a context of their own that the meters ignore, so the
 * machine's own clicks never move its meters.
 */

const KEY = "stash.demo.clicks.v1";
const listeners = new Set<() => void>();
let clicksOn = true;
try {
  clicksOn = window.localStorage.getItem(KEY) !== "off";
} catch {
  // Storage blocked: clicks on for this visit.
}

export function setClicks(on: boolean) {
  clicksOn = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // This visit only.
  }
  for (const l of listeners) l();
  if (on) click("key");
}

export function useClicks(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => clicksOn,
    () => true,
  );
}

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  unmetered(ctx);
  const n = Math.round(ctx.sampleRate * 0.03);
  noise = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 4);
  return ctx;
}

export type ClickKind = "pad" | "key" | "tick";

/**
 * One click. A pad is a soft rubber thump, a key a short plastic snap, a tick the knob's detent.
 * Quiet by design: under the music, never over it.
 */
export function click(kind: ClickKind) {
  if (!clicksOn) return;
  const c = context();
  if (!c || !noise) return;
  if (c.state === "suspended") void c.resume();
  const t = c.currentTime + 0.002;
  const out = c.createGain();
  out.connect(c.destination);
  // The snap: a burst of noise through a band-pass, pitched by the kind of control.
  const src = c.createBufferSource();
  src.buffer = noise;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = kind === "pad" ? 1400 : kind === "key" ? 3200 : 5200;
  bp.Q.value = kind === "pad" ? 0.9 : 1.6;
  const g = c.createGain();
  const peak = kind === "pad" ? 0.16 : kind === "key" ? 0.11 : 0.05;
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "tick" ? 0.012 : 0.028));
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.04);
  // A pad also has body: a quick low thump under the snap.
  if (kind === "pad") {
    const o = c.createOscillator();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.05);
    const og = c.createGain();
    og.gain.setValueAtTime(0.12, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.07);
  }
}

/** A tiny buzz, on phones that can (never on desktop, and only with clicks on). */
export function buzz(ms = 6) {
  if (!clicksOn) return;
  try {
    (navigator as { vibrate?: (p: number) => boolean }).vibrate?.(ms);
  } catch {
    // No vibration here.
  }
}

// ---------------------------------------------------------------------------------------------
// Presses, site-wide: one listener, not one per control.

const PRESSABLE = ".sp-pad, .sp-key, .sp-cart, button, [role=button], nav[aria-label='Demo sections'] a, [role=slider].sp-knob";
const MIN_PRESS_MS = 110;

function kindOf(el: Element): ClickKind {
  if (el.matches(".sp-pad, nav[aria-label='Demo sections'] a, .sp-cart")) return "pad";
  return "key";
}

/** Starts the site-wide press handling. Call once. */
export function startTactile() {
  if (typeof document === "undefined") return;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const el = (e.target as Element | null)?.closest?.(PRESSABLE);
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
      if (el.matches("[role=slider]")) return; // A knob ticks as it turns instead.
      const h = el as HTMLElement;
      h.dataset.pressed = "";
      const down = performance.now();
      click(kindOf(el));
      if (e.pointerType === "touch") buzz(el.matches(".sp-pad") ? 8 : 5);
      const up = () => {
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
        const left = MIN_PRESS_MS - (performance.now() - down);
        setTimeout(() => delete h.dataset.pressed, Math.max(0, left));
      };
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    },
    { passive: true, capture: true },
  );
  // Keyboard presses feel the same: Space or Enter on a control clicks it.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
      const el = (e.target as Element | null)?.closest?.(PRESSABLE);
      if (el && !el.matches("[role=slider]")) click(kindOf(el));
    },
    { capture: true },
  );
}

/** The CLK key: the machine's clicks on or off, with its LED. */
export function ClickToggle({ className = "" }: { className?: string }) {
  const on = useClicks();
  return (
    <button type="button" className={`sp-clk ${className}`} aria-pressed={on} onClick={() => setClicks(!on)} title={on ? "Clicks on" : "Clicks off"}>
      <span className="sp-led" data-on={on || undefined} aria-hidden="true" />
      <span aria-hidden="true">CLK</span>
      <span className="sr-only">Button clicks</span>
    </button>
  );
}
