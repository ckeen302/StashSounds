import type { MidiNotesFile } from "@stash/contracts";
import { useEffect, useRef } from "react";

/**
 * The piano roll: a canvas that draws a notes file on a bar and beat grid, with a keyboard strip
 * down the left. While it plays, the playhead sweeps across, the notes under it light up in the
 * accent and their keys go down on the strip. Colors come from the theme tokens at draw time, so it
 * follows the look the page is in.
 */

export type PianoRollProps = {
  notes: MidiNotesFile;
  /** The beat sounding now; read every frame while `playing`. */
  getBeat?: () => number;
  playing?: boolean;
  /** Semitones the listener has shifted the key by; the notes move with it (not for drums). */
  transpose?: number;
  variant?: "hero" | "mini";
  label: string;
  onSeek?: (beat: number) => void;
  onAudition?: (pitch: number) => void;
  className?: string;
};

const BLACK = new Set([1, 3, 6, 8, 10]);
const DRUM_NAMES: Record<number, string> = {
  35: "Kick", 36: "Kick", 37: "Rim", 38: "Snare", 39: "Clap", 40: "Snare", 41: "Tom", 42: "Hat", 43: "Tom", 44: "Pedal",
  45: "Tom", 46: "Open hat", 47: "Tom", 48: "Tom", 49: "Crash", 50: "Tom", 51: "Ride", 55: "Splash", 57: "Crash", 59: "Ride",
};
const MAX_VISIBLE_BEATS = 32;

type Colors = Record<"bg" | "surface" | "raised" | "border" | "strong" | "text" | "muted" | "note" | "accent", string>;

function readColors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--color-bg"),
    surface: v("--color-surface"),
    raised: v("--color-raised"),
    border: v("--color-border"),
    strong: v("--color-border-strong"),
    text: v("--color-text"),
    muted: v("--color-text-muted"),
    note: v("--color-type-midi"),
    accent: v("--color-accent"),
  };
}

export function PianoRoll({ notes, getBeat, playing = false, transpose = 0, variant = "hero", label, onSeek, onAudition, className }: PianoRollProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useRef({ keyW: 0, beatW: 0, windowStart: 0, visible: 0, rows: [] as number[], rowH: 0, top: 0 });

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let colors = readColors(box);
    let raf = 0;
    let w = 0;
    let h = 0;

    const draw = () => {
      const file = notes;
      const tr = transpose;
      const gb = getBeat;
      const on = playing;
      const shift = file.drums ? 0 : tr;
      const hero = variant === "hero";
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const bpb = (file.timeSignature[0] * 4) / file.timeSignature[1];
      const length = file.bars * bpb;
      const visible = Math.min(length, Math.max(bpb, Math.floor(MAX_VISIBLE_BEATS / bpb) * bpb));
      const beat = gb ? gb() : 0;
      const windowStart = Math.floor(beat / visible) * visible;

      // Rows: every semitone in range (padded), or one row per drum sound.
      let rows: number[];
      if (file.drums) rows = [...new Set(file.notes.map((n) => n[2]))].sort((a, b) => b - a);
      else {
        const pad = hero ? 2 : 1;
        let lo = file.pitchMin + shift - pad;
        let hi = file.pitchMax + shift + pad;
        const minSpan = hero ? 18 : 8;
        while (hi - lo + 1 < minSpan) {
          hi++;
          if (hi - lo + 1 < minSpan) lo--;
        }
        rows = [];
        for (let p = hi; p >= lo; p--) rows.push(p);
      }
      const keyW = hero ? (file.drums ? 64 : 40) : 0;
      const top = hero ? 18 : 0;
      const rowH = (h - top) / rows.length;
      const beatW = (w - keyW) / visible;
      layout.current = { keyW, beatW, windowStart, visible, rows, rowH, top };
      const rowOf = new Map(rows.map((p, i) => [p, i]));

      // Background rows.
      ctx.fillStyle = colors.surface;
      ctx.fillRect(keyW, top, w - keyW, h - top);
      if (!file.drums) {
        ctx.fillStyle = colors.bg;
        rows.forEach((p, i) => {
          if (BLACK.has(((p % 12) + 12) % 12)) ctx.fillRect(keyW, top + i * rowH, w - keyW, rowH);
        });
      } else {
        ctx.fillStyle = colors.bg;
        rows.forEach((_, i) => i % 2 && ctx.fillRect(keyW, top + i * rowH, w - keyW, rowH));
      }

      // Grid: sixteenths faint on the hero, beats, bars strong; bar numbers on top.
      for (let b = 0; b <= visible; b += hero ? 0.25 : 1) {
        const x = Math.round(keyW + b * beatW) + 0.5;
        const abs = windowStart + b;
        const isBar = Math.abs(abs % bpb) < 1e-6;
        const isBeat = Math.abs(abs % 1) < 1e-6;
        if (!hero && !isBar) continue;
        ctx.strokeStyle = isBar ? colors.strong : colors.border;
        ctx.globalAlpha = isBar ? 0.7 : isBeat ? 0.9 : 0.35;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (hero && isBar && b < visible) {
          ctx.fillStyle = colors.muted;
          ctx.font = "500 10px 'JetBrains Mono Variable', ui-monospace, monospace";
          ctx.textBaseline = "middle";
          ctx.fillText(String(Math.round(abs / bpb) + 1), x + 4, top / 2);
        }
      }

      // Notes.
      const active = new Set<number>();
      const radius = Math.min(3, rowH / 3);
      for (const [start, len, pitch, vel] of file.notes) {
        if (start + len < windowStart || start > windowStart + visible) continue;
        const p = pitch + shift;
        const r = rowOf.get(p);
        if (r === undefined) continue;
        const on = !!(gb && on_(beat, start, len, file.drums));
        if (on) active.add(p);
        const x = keyW + (start - windowStart) * beatW;
        const nw = Math.max(file.drums ? Math.min(beatW * 0.2, 8) : 2, len * beatW - 1);
        const y = top + r * rowH + (hero ? 1 : 0.5);
        const nh = Math.max(1.5, rowH - (hero ? 2 : 1));
        ctx.globalAlpha = on ? 1 : 0.45 + (vel / 127) * 0.55;
        ctx.fillStyle = on ? colors.accent : colors.note;
        if (on && hero) {
          ctx.shadowColor = colors.accent;
          ctx.shadowBlur = 12;
        }
        roundRect(ctx, x, y, nw, nh, radius);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      // Keyboard strip.
      if (hero) {
        ctx.fillStyle = colors.raised;
        ctx.fillRect(0, top, keyW, h - top);
        rows.forEach((p, i) => {
          const y = top + i * rowH;
          const pc = ((p % 12) + 12) % 12;
          const black = !file.drums && BLACK.has(pc);
          ctx.fillStyle = active.has(p) ? colors.accent : file.drums ? colors.raised : black ? colors.bg : colors.text;
          ctx.globalAlpha = active.has(p) ? 1 : black ? 1 : 0.88;
          ctx.fillRect(file.drums ? 0 : black ? 0 : 0, y + 0.5, file.drums ? keyW : black ? keyW * 0.62 : keyW, rowH - 1);
          ctx.globalAlpha = 1;
          const name = file.drums ? (DRUM_NAMES[p] ?? String(p)) : pc === 0 ? `C${Math.floor(p / 12) - 1}` : "";
          if (name && rowH >= 9) {
            ctx.fillStyle = active.has(p) || !file.drums ? colors.bg : colors.text;
            ctx.font = `600 ${Math.min(10, rowH - 1)}px 'JetBrains Mono Variable', ui-monospace, monospace`;
            ctx.textBaseline = "middle";
            ctx.fillText(name, file.drums ? 6 : keyW - 20, y + rowH / 2);
          }
        });
        ctx.fillStyle = colors.border;
        ctx.fillRect(keyW - 1, top, 1, h - top);
      }

      // Playhead.
      if (gb && (on || beat > 0)) {
        const x = keyW + (beat - windowStart) * beatW;
        ctx.fillStyle = colors.accent;
        ctx.fillRect(Math.round(x) - (hero ? 1 : 0.5), top, hero ? 2 : 1.5, h - top);
        if (hero) {
          ctx.beginPath();
          ctx.moveTo(x - 5, 0);
          ctx.lineTo(x + 5, 0);
          ctx.lineTo(x, 8);
          ctx.closePath();
          ctx.fill();
        }
      }

      if (playing) raf = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => {
      const r = box.getBoundingClientRect();
      w = r.width;
      h = r.height;
      cancelAnimationFrame(raf);
      draw();
    });
    ro.observe(box);
    // The look can change under the roll: redraw with the new colors.
    const mo = new MutationObserver(() => {
      colors = readColors(box);
      cancelAnimationFrame(raf);
      draw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-look"] });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [variant, notes, playing, transpose, getBeat]);

  const hero = variant === "hero";
  return (
    <div
      ref={wrap}
      role="img"
      aria-label={label}
      className={["relative overflow-hidden", hero ? "h-64 rounded-control border border-border tablet:h-72" : "h-8 rounded-control", onSeek || onAudition ? "cursor-pointer" : "", className ?? ""].join(" ")}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const l = layout.current;
        if (x < l.keyW) {
          const row = Math.floor((y - l.top) / l.rowH);
          const p = l.rows[row];
          if (p !== undefined) onAudition?.(p);
          return;
        }
        if (onSeek && l.beatW > 0) onSeek(l.windowStart + (x - l.keyW) / l.beatW);
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" />
    </div>
  );
}

function on_(beat: number, start: number, len: number, drums: boolean): boolean {
  // Drum hits flash for a sixteenth, however short the note is written.
  return beat >= start && beat < start + (drums ? Math.max(len, 0.22) : len);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
