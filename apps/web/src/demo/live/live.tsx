import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { litSegments, logBars } from "./meter-math";
import { onMeterFrame, type MeterFrame } from "./meter";

/**
 * The parts of the machine that react to sound: the scope on the transport's screen, the VU meters
 * in the top panel, the spectrum on the home screen, and the pads that kick with the beat. All of
 * them write to the DOM or a canvas straight from the meter's frames; nothing here re-renders React
 * per frame.
 */

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/**
 * A scope: the waveform of whatever is sounding, drawn in LCD ink. Flat and dim when nothing is.
 * `variant="bars"` draws the spectrum as LCD segments instead.
 */
export function Scope({ className, variant = "wave", style }: { className?: string; variant?: "wave" | "bars"; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    let ink = cssVar(canvas, "--sp-lcd-ink");
    let dim = cssVar(canvas, "--sp-lcd-dim");
    let w = 0;
    let h = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      ink = cssVar(canvas, "--sp-lcd-ink");
      dim = cssVar(canvas, "--sp-lcd-dim");
    };
    size();
    const ro = new ResizeObserver(() => {
      size();
      draw(last);
    });
    ro.observe(canvas);
    const bars = new Float32Array(32);
    let last: MeterFrame | null = null;
    let wasOn = true;
    const draw = (f: MeterFrame | null) => {
      if (!f || !w) return;
      // Quiet: one flat line, drawn once, not every frame.
      if (!f.on && f.level < 0.01) {
        if (!wasOn) return;
        wasOn = false;
        g.clearRect(0, 0, w, h);
        g.fillStyle = dim;
        if (variant === "bars") for (let x = 0; x < w; x += 6) g.fillRect(x, h - 2, 4, 2);
        else for (let x = 0; x < w; x += 6) g.fillRect(x, h / 2 - 1, 3, 2);
        return;
      }
      wasOn = true;
      g.clearRect(0, 0, w, h);
      if (variant === "bars") {
        logBars(f.bins, bars.length, bars);
        const bw = w / bars.length;
        g.fillStyle = ink;
        for (let i = 0; i < bars.length; i++) {
          const v = Math.pow(bars[i]!, 1.4);
          const segs = Math.round((v * h) / 5);
          for (let s = 0; s < segs; s++) g.fillRect(i * bw + 1, h - (s + 1) * 5 + 1, bw - 3, 3);
        }
        return;
      }
      // The wave: a slice of the latest block, centred on a rising zero crossing so it holds still.
      const wave = f.wave;
      const span = Math.min(wave.length, 1024);
      let start = 0;
      for (let i = 1; i < wave.length - span; i++)
        if (wave[i - 1]! < 0 && wave[i]! >= 0) {
          start = i;
          break;
        }
      g.strokeStyle = ink;
      g.lineWidth = 2;
      g.lineJoin = "round";
      g.beginPath();
      const gain = 0.9 / Math.max(0.25, f.level);
      for (let x = 0; x <= w; x += 2) {
        const v = wave[start + Math.floor((x / w) * span)] ?? 0;
        const y = h / 2 - Math.max(-1, Math.min(1, v * gain)) * (h / 2 - 2);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    const off = onMeterFrame((f) => {
      last = f;
      draw(f);
    });
    return () => {
      off();
      ro.disconnect();
    };
  }, [variant]);
  return <canvas ref={ref} aria-hidden="true" className={className} style={style} />;
}

/** Two LED ladders, left and right, lit by the output level. */
export function VuMeters({ segments = 12, className = "" }: { segments?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ladders = [...root.querySelectorAll<HTMLElement>("[data-ch]")].map((ch) => ({ ch, leds: [...ch.children] as HTMLElement[], lit: -1 }));
    return onMeterFrame((f) => {
      ladders.forEach((l, i) => {
        const n = litSegments(i === 0 ? f.left : f.right, segments);
        if (n === l.lit) return;
        l.lit = n;
        l.leds.forEach((led, j) => {
          if (j < n) led.dataset.on = "";
          else delete led.dataset.on;
        });
      });
    });
  }, [segments]);
  return (
    <div ref={ref} className={`sp-vu ${className}`} aria-hidden="true">
      {["L", "R"].map((c) => (
        <div key={c} className="sp-vu-row">
          <span className="sp-vu-ch">{c}</span>
          <span data-ch={c} className="sp-vu-leds">
            {Array.from({ length: segments }, (_, j) => (
              <span key={j} className="sp-vu-led" data-zone={j >= segments - 2 ? "peak" : j >= segments - 4 ? "hot" : undefined} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Drives a row of spans (an equalizer) from the spectrum: each span's --live is its bar, 0..1. */
export function useLiveBars(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const spans = [...root.children] as HTMLElement[];
    const bars = new Float32Array(spans.length);
    let on = false;
    return onMeterFrame((f) => {
      if (!f.on && f.level < 0.01) {
        if (on) {
          on = false;
          delete root.dataset.live;
          for (const s of spans) s.style.removeProperty("--live");
        }
        return;
      }
      if (!on) {
        on = true;
        root.dataset.live = "";
      }
      logBars(f.bins, spans.length, bars);
      spans.forEach((s, i) => s.style.setProperty("--live", (Math.pow(bars[i]!, 1.3) * 0.94 + 0.06).toFixed(3)));
    });
  }, [ref]);
}

/**
 * On every beat, whatever is playing kicks: the lit pad, the playing row's play key, the transport's
 * play key and the current bank pad. Web Animations, so it costs no style recalculation of the page.
 */
export function BeatPulse() {
  useEffect(() => {
    if (reduced()) return;
    let lastBeat = 0;
    return onMeterFrame((f) => {
      if (!f.beat || f.t - lastBeat < 120) return;
      lastBeat = f.t;
      const hit = document.querySelectorAll<HTMLElement>(
        '[data-playing], button[data-play-state="playing"], nav[aria-label="Demo sections"] a[aria-current="page"], .sp-beat',
      );
      const strength = Math.min(1, 0.4 + f.level);
      for (const el of hit) {
        if (!el.isConnected || !el.getClientRects().length) continue;
        el.animate(
          [
            { transform: `scale(${1 + 0.05 * strength})`, filter: `brightness(${1 + 0.25 * strength})` },
            { transform: "scale(1)", filter: "brightness(1)" },
          ],
          { duration: 180, easing: "cubic-bezier(.2,.8,.3,1)" },
        );
      }
    });
  }, []);
  return null;
}

/** The scope on the transport's own screen: found after the shell mounts, drawn into with a portal. */
export function PlayerScope() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>('section[aria-label="Player"]');
      if (el) setHost(el);
      else raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!host) return null;
  return createPortal(
    <span className="sp-player-scope" aria-hidden="true">
      <Scope className="sp-player-scope-wave" />
    </span>,
    host,
  );
}
